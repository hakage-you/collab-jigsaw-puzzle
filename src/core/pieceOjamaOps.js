import { OJAMA_CONFIG } from '../config/constants.js';
import { getSingleLoosePieces } from './pieceSorter.js';

export function dropLockedPiecesOp(engine, count = OJAMA_CONFIG.DEFAULT_DROP_COUNT) {
  const locked = engine.pieces.filter((p) => p.isLocked);
  if (locked.length === 0) return 0;

  const actual = Math.min(count, locked.length);
  const chosen = [];
  const pool = [...locked];
  for (let i = 0; i < actual; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    chosen.push(pool.splice(idx, 1)[0]);
  }

  const padX = engine.boardW / 2 + engine.pieceW * 1.1;
  const padY = engine.boardH / 2 + engine.pieceH * 1.1;

  chosen.forEach((p, idx) => {
    p.isLocked = false;
    p.groupId = engine.nextGroupId++;
    p.zOrder = engine.maxZ++;
    const side = idx % 4;
    if (side === 0) {
      p.x = (Math.random() - 0.5) * engine.boardW;
      p.y = -padY - Math.random() * engine.pieceH;
    } else if (side === 1) {
      p.x = padX + Math.random() * engine.pieceW;
      p.y = (Math.random() - 0.5) * engine.boardH;
    } else if (side === 2) {
      p.x = (Math.random() - 0.5) * engine.boardW;
      p.y = padY + Math.random() * engine.pieceH;
    } else {
      p.x = -padX - Math.random() * engine.pieceW;
      p.y = (Math.random() - 0.5) * engine.boardH;
    }
  });

  engine.completedFired = false;
  engine.stats.ojamaTotal += 1;
  engine.stats.ojamaBreakdown.drop += 1;
  engine.bumpLockedVersion();
  engine.bumpZVersion();
  return actual;
}

export function prankLoosePiecesOp(
  engine,
  count = OJAMA_CONFIG.PRANK_DEFAULT_COUNT,
  excludedGroupIds = null
) {
  const singles = getSingleLoosePieces(engine, excludedGroupIds);
  let targets = singles;
  if (targets.length === 0) {
    targets = engine.pieces.filter(
      (p) => !p.isLocked && (!excludedGroupIds || !excludedGroupIds.has(p.groupId))
    );
  }
  if (targets.length === 0) return 0;

  const pool = [...targets];
  const actual = Math.min(count, pool.length);
  const groupCounts = engine.getGroupCounts();

  for (let i = 0; i < actual; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    const p = pool.splice(idx, 1)[0];
    const isSingle = groupCounts.get(p.groupId) === 1;
    if (isSingle && Math.random() < 0.45) {
      p.isFlipped = !p.isFlipped;
    } else {
      const delta = 1 + Math.floor(Math.random() * 3);
      const group = engine.getGroupPieces(p.groupId);
      const px = p.x;
      const py = p.y;
      for (const gp of group) {
        let dx = gp.x - px;
        let dy = gp.y - py;
        for (let step = 0; step < delta; step++) {
          const nx = -dy;
          const ny = dx;
          dx = nx;
          dy = ny;
          gp.rotation = (gp.rotation + 1) % 4;
        }
        gp.x = px + dx;
        gp.y = py + dy;
      }
    }
    engine.bringGroupToFront(p.groupId);
  }

  engine.stats.ojamaTotal += 1;
  engine.stats.ojamaBreakdown.prank += 1;
  return actual;
}
