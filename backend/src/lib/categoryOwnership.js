import { query } from '../db.js';

export async function userOwnsCategory(categoryId, userId, database = query) {
  if (!categoryId) return true;

  const result = await database(
    'SELECT id FROM categories WHERE id = $1 AND user_id = $2',
    [categoryId, userId]
  );
  return result.rowCount > 0;
}
