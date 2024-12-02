import express from "express";
import ViteExpress from "vite-express";
const path = require('path');

// creates the expres app do not change
const app = express();

// add your routes here

// example route which returns a message
app.get("/hello", async function (_req, res) {
  res.status(200).json({ message: "Hello World!" });
});

// endpoint to get datasets
app.get('/geojson_output/:filename', (req, res) => {

  const filename = req.params.filename;

  const filePath = path.join(__dirname, 'geojson_output', filename);

  res.sendFile(filePath, (err) => {
    if (err) {
      console.log(`File not found ${filePath}`);
      res.status(404).send('File not found');
    }
  })
});

// Do not change below this line
ViteExpress.listen(app, 5173, () =>
    console.log("Server is listening on http://localhost:5173"),
);
