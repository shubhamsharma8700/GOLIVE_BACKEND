import dotenv from 'dotenv';
dotenv.config();

import bodyParser from 'body-parser';
import express from 'express';
import adminRoutes from './src/routes/admin.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use('/api/admins', adminRoutes);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

app.listen(PORT, () => {
  console.log(`Admin API running on port ${PORT}`);
});
console.log("Loaded TABLE:", process.env.DYNAMODB_TABLE);
