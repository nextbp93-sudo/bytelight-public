import { Router } from 'express';
import { listDrawerItems } from '../services/db/drawer.js';

const router = Router();

router.get('/drawer', (req, res) => {
  const companion = typeof req.query.companion === 'string' ? req.query.companion.trim() : undefined;
  res.json({ items: listDrawerItems(companion || undefined) });
});

export default router;
