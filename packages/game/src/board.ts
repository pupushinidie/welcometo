/** 赛道编号 2–12（两颗骰子的和）。 */
export const COLUMNS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
export type Column = (typeof COLUMNS)[number];

/** 每条赛道的格数：点数越常见赛道越长（规格书 2.1）。 */
export const COLUMN_HEIGHTS: Readonly<Record<Column, number>> = {
  2: 3, 3: 5, 4: 7, 5: 9, 6: 11, 7: 13, 8: 11, 9: 9, 10: 7, 11: 5, 12: 3,
};

export const MAX_HEIGHT = 13;

/** 4 颗骰子两两分组的 3 种方式（下标）。 */
export const PAIRINGS = [
  [[0, 1], [2, 3]],
  [[0, 2], [1, 3]],
  [[0, 3], [1, 2]],
] as const;

export function isColumn(value: unknown): value is Column {
  return (COLUMNS as readonly unknown[]).includes(value);
}
