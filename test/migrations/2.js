export const up = async function (sql) {
  return await sql`
    ALTER TABLE migrations4test_1 ADD COLUMN dummy INTEGER NULL
    `
}

export const down = async function (sql) {
  return await sql`
    ALTER TABLE migrations4test_1 DROP COLUMN dummy
    `
}
