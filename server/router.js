const { Pool } = require('pg');
const path = require('path');
//const router = require("express-promise-router")(); //might try to implement this later
const router = require('express').Router();

const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
  password: process.env.DB_PASS
});

router.get('/qa/questions', async (req, res) => {
  //get all of the questions/answers/answerPhotos for a particular product
  try {
    //req.query.product_id
    //req.query.page === 1 used in all Legacy frontend requests
    //req.query.count === 50 used in all Legacy frontend requests
    !req.query.page ? req.query.page = 0 : req.query.page;
    req.query.page > 0 ? req.query.page-- : req.query.page;
    !req.query.count ? req.query.count = 50 : req.query.count;
    const values = [req.query.product_id, req.query.page * req.query.count, req.query.count];
    const query =
    `SELECT
      q.id AS question_id,
      q.body AS question_body,
      q.question_date,
      q.asker_name,
      q.helpful AS question_helpfulness,
      q.reported,
      (SELECT COALESCE(json_agg(
        json_build_object(
          'id', a.id,
          'body', a.body,
          'date', a.date,
          'answerer_name', a.answerer_name,
          'helpfulness', a.helpful,
          'photos',
            (SELECT COALESCE(array_agg(p.url), ARRAY[]::varchar[])
            FROM photos p WHERE p.answer_id = a.id)
        )
        ORDER BY a.helpful DESC
        ), '[]'::json)
        FROM answers a
        WHERE q.id = a.question_id AND a.reported = false

      ) AS answers
  FROM questions q
  WHERE q.product_id=$1 AND q.reported = false
  ORDER BY q.helpful DESC
  OFFSET $2 ROWS
  FETCH FIRST $3 ROWS ONLY;`;
    const client = await pool.connect();
    const result = await client.query(query, values);
    var formatted = {
      product_id: req.query.product_id,
      results: result.rows
    }
    res.send(formatted);
    client.release();
  } catch (err) {
    console.error(err);
    res.send("Error " + err);
  }
});

//not used by current frontend but exists in the backend so will implement after optimizations have been made as its a very low priority.
router.get('/qa/questions/:question_id/answers', async (req, res) => {
  //get all of the answers for a particular question
  try {
    //req.query.question_id
    //req.query.page === 1
    //req.query.count === 50
    //for this get need to get the sorted answers list
    //then need to get the photos array for each one and put it in the appropriate spot.
    !req.query.page ? req.query.page = 0 : req.query.page;
    req.query.page > 0 ? req.query.page-- : req.query.page;
    !req.query.count ? req.query.count = 2 : req.query.count; //default of 2
    const values = [req.params.question_id, req.query.page * req.query.count, req.query.count];
    const query =
    `SELECT
      a.id,
      a.body,
      a.date,
      a.answerer_name,
      a.helpful AS helpfulness,
      (SELECT COALESCE(json_agg(json_build_object('id', p.id, 'url', p.url)), '[]'::json)
              FROM photos p WHERE p.answer_id = a.id) AS photos
    FROM answers a
    WHERE a.question_id = $1 AND a.reported = false
    ORDER BY a.helpful DESC
    OFFSET $2 ROWS
    FETCH FIRST $3 ROWS ONLY;`
    ;
    const client = await pool.connect();
    const result = await client.query(query, values);
    const formatted = {
      question_id: req.params.question_id,
      page: req.query.page,
      count: req.query.count,
      results: result.rows
    };
    res.send(formatted);
    client.release();
  } catch (err) {
    console.error(err);
    res.send("Error " + err);
  }
});

router.post('/qa/questions', async (req, res) => {
  //post a question for the given product
  try {
    //req.body. body/name/email/product_id
    const values = [req.body.body, req.body.name, req.body.email, req.body.product_id];
    const query = `INSERT INTO questions(body, asker_name, asker_email, product_id) VALUES ($1, $2, $3, $4)`;
    const client = await pool.connect();
    const result = await client.query(query, values);
    res.sendStatus(201);
    client.release();
  } catch (err) {
    console.error(err);
    res.send("Error " + err);
  }
});

router.post('/qa/questions/:question_id/answers', async (req, res) => {
  //adds an answer for a given question
  try {
    const values = [req.body.body, req.body.name, req.body.email, req.body.product_id];
    const query = `INSERT INTO answers(body, answerer_name, answerer_email, question_id) VALUES ($1, $2, $3, $4) RETURNING id AS answer_id`;
    const client = await pool.connect();
    const result = await client.query(query, values);
    req.body.photos.map(async (url) => {
      const values = [url, result.answer_id]
      const query = `INSERT INTO photos (url, answer_id) VALUES ($1, $2)`;
      await client.query(query, values);
    });
    res.sendStatus(201);
    client.release();
  } catch (err) {
    console.error(err);
    res.send("Error " + err);
  }
});

router.put('/qa/questions/:question_id/helpful', async (req, res) => {
  //updates a question to show that it was found helpful
  try {
    const values = [req.params.question_id];
    const query = `UPDATE questions SET helpful = helpful + 1 WHERE id = $1`;
    const client = await pool.connect();
    const result = await client.query(query, values);
    res.sendStatus(201);
    client.release();
  } catch (err) {
    console.error(err);
    res.send("Error " + err);
  }
});

router.put('/qa/answers/:answer_id/helpful', async (req, res) => {
  //updates an answer to show that it was found helpful
  try {
    const values = [req.params.answer_id];
    const query = `UPDATE answers SET helpful = helpful + 1 WHERE id = ${req.params.answer_id}`;
    const client = await pool.connect();
    const result = await client.query(query, values);
    res.sendStatus(201);
    client.release();
  } catch (err) {
    console.error(err);
    res.send("Error " + err);
  }
});

router.put('qa/answers/:answer_id/report', async (req, res) => {
  //reports an answer to be reviewed later
  try {
    const values = [req.params.answer_id];
    const query = `UPDATE answers SET reported = true WHERE id = $1`;
    const client = await pool.connect();
    const result = await client.query(query, values);
    res.sendStatus(201);
    client.release();
  } catch (err) {
    console.error(err);
    res.send("Error " + err);
  }
});

module.exports = router;

//$1= req.params.product_id
//$2= req.params.page
//$3= req.params.count
// const values = [req.params.product_id, req.params.page * req.params.count, req.params.count];

//just maintaining the first query I set up for when i undergo optimizations

// const query =
// SELECT
//   q.id AS question_id,
//   q.body AS question_body,
//   q.question_date,
//   q.asker_name,
//   q.helpful AS question_helpfulness,
//   q.reported,
//   a.id,
//   a.body,
//   a.date,
//   a.answerer_name,
//   a.helpful AS helpfulness,
//   p.url

// FROM questions q
// LEFT JOIN answers a ON q.id = a.question_id
// LEFT JOIN photos p ON a.id = p.answer_id
// WHERE q.reported = false AND q.product_id=$1
// ORDER BY q.helpful DESC
// OFFSET $2 ROWS
// FETCH FIRST $3 ROWS ONLY;
