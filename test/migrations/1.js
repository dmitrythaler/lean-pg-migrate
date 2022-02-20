const up = async function (trx) {

  try {
    // console.log('1.js UP!')
    await trx.none(
      'CREATE TABLE migrations4test_1 (id SERIAL PRIMARY KEY, name TEXT)'
    )
    // console.log('1.js UP! done')
  } catch(error) {
    console.error( 'shit happens', error )
    throw error
  }

}

const down = async function (trx) {
  await trx.none(
    'DROP TABLE migrations4test_1'
  )
}

module.exports = { up, down }