export const up = async function (sql) {
  return await sql`
    ALTER TABLE migrations4test_1 ADD CONSTRAINT U_pen_name UNIQUE(pen_name)
    `
}

export const down = async function (sql) {
  return await sql`
    ALTER TABLE migrations4test_1 DROP CONSTRAINT U_pen_name
    `
}
