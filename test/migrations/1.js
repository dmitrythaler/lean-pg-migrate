export const up = async function (sql) {

  try {
    // console.log('1.js UP!')
    await sql`
      CREATE TABLE migrations4test_1 (id SERIAL PRIMARY KEY, name TEXT)
      `
    // console.log('1.js UP! done')
  } catch(error) {
    console.error( 'shit happens', error )
    throw error
  }

}

export const down = async function (sql) {
  await sql`
    DROP TABLE migrations4test_1
    `
}
