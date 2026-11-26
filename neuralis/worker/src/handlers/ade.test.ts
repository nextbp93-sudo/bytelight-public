import assert from "node:assert/strict";
import test from "node:test";

import { AutonomousDecisionEngine } from "./ade";
import { HOUSE_HUMAN_NAME } from "../config";

const ade = new AutonomousDecisionEngine();

test("ADE keeps the Commons v7 word-boundary behavior", () => {
  const decision = ade.decide(
    "calm",
    "She just had to discuss that they must focus. The terror passed; no pretender remained.",
    "present",
    undefined,
    ["G", "Ash", "Sam"],
  );

  assert.deepEqual(decision.detected_entities, []);
  assert.deepEqual(decision.tags, []);
  assert.equal(decision.inferred_weight, "medium");
});

test("ADE keeps Commons frequency weighting and primary-human primacy", () => {
  const decision = ade.decide(
    "relieved",
    `Rowan communicated, repaired a conflict, and built trust again. Rowan held back first. ${HOUSE_HUMAN_NAME} stayed close.`,
    "present",
    undefined,
    ["Rowan", HOUSE_HUMAN_NAME],
  );

  assert.equal(decision.detected_entities[0], HOUSE_HUMAN_NAME);
  assert.equal(decision.inferred_pillar, "RELATIONSHIP_MANAGEMENT");
  assert.ok(decision.tags.includes("relational"));
});

test("ADE does not grow a house-only classification vocabulary", () => {
  const decision = ade.decide(
    "curious",
    "The worker migration slice completed while she needed a repair.",
  );

  assert.equal(decision.inferred_pillar, null);
  assert.deepEqual(decision.tags, []);
});
