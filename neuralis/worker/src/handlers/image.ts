import type { Env } from "../types";
import { imageUrl, r2Prefix, workerUrl, getEmbedding, normalizeText } from "../utils";
import { getImageEmbedding } from "../embeddings";

export async function handleMindStoreImage(env: Env, params: Record<string, unknown>): Promise<string> {
  const action = params.action as string;

  // === STORE_COMPLETE: Hook already uploaded the file, just format the result ===
  if (action === "store_complete") {
    const uploadResult = params._upload_result as Record<string, unknown>;
    if (!uploadResult) return "Error: no upload result from hook.";
    let response = `Image stored (#${uploadResult.id})`;
    if (uploadResult.format === "image/webp") response += ` [converted to WebP]`;
    if (uploadResult.embedded) response += ` [multimodal embedded]`;
    if (uploadResult.embedding_note) response += ` (${uploadResult.embedding_note})`;
    response += `\nPath: ${uploadResult.path}`;
    if (uploadResult.compression) response += ` | ${uploadResult.original_size} -> ${uploadResult.final_size} (${uploadResult.compression})`;
    if (uploadResult.entity) response += `\nEntity: ${uploadResult.entity}`;
    if (uploadResult.emotion) response += ` | Emotion: ${uploadResult.emotion}`;
    return response;
  }

  // === STORE: Upload image to R2 + multimodal embedding ===
  if (action === "store") {
    const imageData = params.image_data as string;
    const mimeType = (params.mime_type as string) || "image/png";
    const filename = params.filename as string;
    const description = params.description as string;
    const entityName = params.entity_name as string;
    const emotion = params.emotion as string;
    const weight = (params.weight as string) || "medium";
    const context = params.context as string;
    const observationId = params.observation_id as number;

    if (!description) return "Error: description is required for storing images.";
    const allowedTypes = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "image/svg+xml"]);
    if (!allowedTypes.has(mimeType)) return `Error: unsupported image type '${mimeType}'. Allowed: png, jpeg, webp, gif, svg.`;

    // Resolve entity
    let entityId: number | null = null;
    if (entityName) {
      const entity = await env.DB.prepare("SELECT id FROM entities WHERE name = ?").bind(entityName).first();
      if (entity) entityId = entity.id as number;
    }

    // Upload to R2 with WebP conversion
    let storedPath: string | null = null;
    let finalBinary: Uint8Array | null = null;
    if (imageData && env.R2_IMAGES) {
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const safeName = (filename || description.slice(0, 50))
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .replace(/_+/g, "_")
        .slice(0, 60);
      const rawKey = `_tmp_${date}_${safeName}`;
      const webpKey = `${date}_${safeName}.webp`;

      const binary = Uint8Array.from(atob(imageData), c => c.charCodeAt(0));

      // Store raw image temporarily for cf.image to fetch
      await env.R2_IMAGES.put(rawKey, binary, { httpMetadata: { contentType: mimeType } });

      // Convert to WebP via Cloudflare Image Resizing
      try {
        const r2Url = `${workerUrl(env)}/r2/${rawKey}`;
        const webpResponse = await fetch(r2Url, {
          cf: {
            image: {
              format: "webp",
              quality: 80,
              fit: "scale-down",
              width: 1920,
              height: 1920,
            },
          },
        });

        if (webpResponse.ok) {
          const webpBuffer = await webpResponse.arrayBuffer();
          finalBinary = new Uint8Array(webpBuffer);
          await env.R2_IMAGES.put(webpKey, webpBuffer, { httpMetadata: { contentType: "image/webp" } });
          storedPath = `r2://${r2Prefix(env)}/${webpKey}`;
        } else {
          // cf.image not available (e.g., dev mode) — keep original
          await env.R2_IMAGES.put(webpKey.replace('.webp', mimeType === 'image/jpeg' ? '.jpg' : '.png'), binary, { httpMetadata: { contentType: mimeType } });
          storedPath = `r2://${r2Prefix(env)}/${webpKey.replace('.webp', mimeType === 'image/jpeg' ? '.jpg' : '.png')}`;
          finalBinary = binary;
        }
      } catch {
        // Fallback: store original format
        const fallbackKey = `${date}_${safeName}${mimeType === 'image/jpeg' ? '.jpg' : '.png'}`;
        await env.R2_IMAGES.put(fallbackKey, binary, { httpMetadata: { contentType: mimeType } });
        storedPath = `r2://${r2Prefix(env)}/${fallbackKey}`;
        finalBinary = binary;
      }

      // Clean up temp file
      await env.R2_IMAGES.delete(rawKey).catch(() => {});
    }

    // Insert into images table
    const path = storedPath || (params.path as string) || "pending";
    const result = await env.DB.prepare(`
      INSERT INTO images (path, description, context, emotion, weight, entity_id, observation_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(path, description, context || null, normalizeText(emotion), weight, entityId, observationId || null).run();

    const imageId = result.meta.last_row_id;

    // Generate embedding — multimodal if we have image data, text fallback otherwise
    let embedding: number[];
    try {
      if (imageData) {
        // Combine visual + contextual meaning for richer embeddings
        const contextText = [
          entityName ? `${entityName}:` : "", description,
          context ? `(${context})` : "", emotion ? `[${emotion}]` : ""
        ].filter(Boolean).join(" ");
        const embeddingBinary = finalBinary || Uint8Array.from(atob(imageData), c => c.charCodeAt(0));
        embedding = await getImageEmbedding(env.GEMINI_API_KEY, embeddingBinary.buffer as ArrayBuffer, storedPath?.includes('.webp') ? 'image/webp' : mimeType, contextText);
      } else {
        const semanticText = [
          entityName ? `${entityName}:` : "", description,
          context ? `(${context})` : "", emotion ? `[${emotion}]` : ""
        ].filter(Boolean).join(" ");
        embedding = await getEmbedding(env, semanticText);
      }
    } catch {
      // Fallback to text embedding
      const semanticText = [
        entityName ? `${entityName}:` : "", description,
        context ? `(${context})` : "", emotion ? `[${emotion}]` : ""
      ].filter(Boolean).join(" ");
      embedding = await getEmbedding(env, semanticText);
    }

    const imgMetadata: Record<string, string> = {
      source: "image", description, weight, added_at: new Date().toISOString()
    };
    if (entityName) imgMetadata.entity = entityName;
    if (context) imgMetadata.context = context;
    if (emotion) imgMetadata.emotion = normalizeText(emotion) || emotion;
    if (path) imgMetadata.path = path;

    await env.VECTORS.upsert([{ id: `img-${imageId}`, values: embedding, metadata: imgMetadata }]);

    let response = `Image stored (#${imageId})`;
    if (imageData && storedPath?.includes('.webp')) response += ` [converted to WebP, uploaded to R2, multimodal embedded]`;
    else if (imageData) response += ` [uploaded to R2, multimodal embedded]`;
    else response += ` [text embedded]`;
    if (entityName) response += ` -> ${entityName}`;
    if (emotion) response += ` [${emotion}]`;
    if (path) response += `\nPath: ${path}`;
    return response;
  }

  // === VIEW: Browse images by filter ===
  if (action === "view") {
    const entityName = params.entity_name as string;
    const emotion = params.emotion as string;
    const weight = params.weight as string;
    const random = params.random as boolean;
    const limit = (params.limit as number) || 5;

    let query = `SELECT i.*, e.name as entity_name, e.entity_type FROM images i LEFT JOIN entities e ON i.entity_id = e.id WHERE 1=1`;
    const bindings: unknown[] = [];

    if (entityName) { query += ` AND e.name = ?`; bindings.push(entityName); }
    if (emotion) { query += ` AND i.emotion = ?`; bindings.push(emotion); }
    if (weight) { query += ` AND i.weight = ?`; bindings.push(weight); }
    query += random ? ` ORDER BY RANDOM()` : ` ORDER BY i.created_at DESC`;
    query += ` LIMIT ?`;
    bindings.push(limit);

    const images = await env.DB.prepare(query).bind(...bindings).all();
    if (!images.results?.length) {
      return `No visual memories found. Use mind_store_image(action="store") to add some.`;
    }

    for (const id of images.results.map((i: any) => i.id)) {
      await env.DB.prepare(`UPDATE images SET last_viewed_at = datetime('now'), view_count = view_count + 1 WHERE id = ?`).bind(id).run();
    }

    let output = `## Visual Memories\n\n`;
    if (random) output += `*Random selection*\n\n`;
    for (const img of images.results as any[]) {
      const emotionTag = img.emotion ? ` [${img.emotion}]` : "";
      const entityTag = img.entity_name ? ` -> ${img.entity_name}` : "";
      output += `**#${img.id}** [${img.weight}]${emotionTag}${entityTag}\n`;
      output += `${img.description}\n`;
      if (img.context) output += `*${img.context}*\n`;
      if (img.path?.startsWith("r2://")) {
        output += `View: ${await imageUrl(img.id, env)}\n`;
      } else if (img.path && img.path !== "pending") {
        output += `Path: \`${img.path}\`\n`;
      }
      output += `\n`;
    }
    return output;
  }

  // === SEARCH: Semantic image search via pgvector ===
  if (action === "search") {
    const query = params.query as string;
    const limit = (params.limit as number) || 5;
    if (!query) return "Error: query is required for image search.";

    const embedding = await getEmbedding(env, query);
    const results = await env.VECTORS.query(embedding, { topK: limit * 3, returnMetadata: "all" });

    const imageMatches = results.matches?.filter((m: any) => m.id.startsWith("img-")) || [];
    if (!imageMatches.length) return "No images match that query.";

    let output = `## Image Search: "${query}"\n\n`;
    for (const match of imageMatches.slice(0, limit)) {
      const meta = match.metadata as Record<string, string>;
      const score = Math.round(match.score * 100);
      output += `**${match.id}** (${score}%)`;
      if (meta?.entity) output += ` -> ${meta.entity}`;
      if (meta?.emotion) output += ` [${meta.emotion}]`;
      const imgId = match.id.replace("img-", "");
      output += `\n${meta?.description || "No description"}\n`;
      output += `View: ${await imageUrl(imgId, env)}\n`;
      output += `\n`;
    }
    return output;
  }

  // === DELETE: Remove image + embedding + R2 ===
  if (action === "delete") {
    const imgId = params.image_id as number;
    if (!imgId) return "Error: image_id required for delete.";
    const img = await env.DB.prepare(`SELECT path, description FROM images WHERE id = ?`).bind(imgId).first();
    if (!img) return `Image #${imgId} not found.`;
    await env.DB.prepare(`DELETE FROM images WHERE id = ?`).bind(imgId).run();
    try { await env.DB.prepare(`DELETE FROM embeddings WHERE id = ?`).bind(`img-${imgId}`).run(); } catch {}
    const imgPrefix = r2Prefix(env);
    if (img.path && String(img.path).startsWith(`r2://${imgPrefix}/`)) {
      const r2Key = String(img.path).replace(`r2://${imgPrefix}/`, "");
      try { await env.R2_IMAGES.delete(r2Key); } catch {}
    }
    return `Deleted image #${imgId}: "${String(img.description).slice(0, 50)}..." [DB + embedding + R2 cleaned]`;
  }

  return "Unknown action. Use: store, view, search, or delete.";
}
