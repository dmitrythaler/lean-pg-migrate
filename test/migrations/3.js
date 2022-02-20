const up = async function (trx) {
  return await trx.none(
    'ALTER TABLE migrations4test_1 ADD COLUMN pen_name TEXT NULL'
  )
}

const down = async function (trx) {
  return await trx.none(
    'ALTER TABLE migrations4test_1 DROP COLUMN pen_name'
  )
}

module.exports = { up, down }