const up = async function (trx) {
  return await trx.none(
    'ALTER TABLE migrations4test_1 ADD CONSTRAINT U_pen_name UNIQUE(pen_name)'
  )
}

const down = async function (trx) {
  return await trx.none(
    'ALTER TABLE migrations4test_1 DROP CONSTRAINT U_pen_name'
  )
}

module.exports = { up, down }
