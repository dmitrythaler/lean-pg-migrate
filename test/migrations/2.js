const up = async function (trx) {
  return await trx.none(
    'ALTER TABLE migrations4test_1 ADD COLUMN dummy INTEGER NULL'
  )
}

const down = async function (trx) {
  return await trx.none(
    'ALTER TABLE migrations4test_1 DROP COLUMN dummy'
  )
}

module.exports = { up, down }