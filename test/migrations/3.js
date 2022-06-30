const up = async function (sql) {
  return await sql`
    ALTER TABLE migrations4test_1 ADD COLUMN pen_name TEXT NULL
    `
}

const down = async function (sql) {
  return await sql`
    ALTER TABLE migrations4test_1 DROP COLUMN pen_name
    `
  }

module.exports = { up, down }