const mongoose = require('mongoose');

let indexesBuilt = false;

/** Connects once and reuses the connection (important on Vercel, where a warm function serves many requests). */
async function connectDB({ mongoUri, mongoDb }) {
  mongoose.set('strictQuery', true);
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(mongoUri, { dbName: mongoDb, serverSelectionTimeoutMS: 15000, maxPoolSize: 10 });
  }
  require('../models');
  if (!indexesBuilt) {
    await Promise.all(Object.values(mongoose.models).map((m) => m.init())); // build indexes up front
    indexesBuilt = true;
  }
}
module.exports = connectDB;
