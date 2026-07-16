/**
 * Cloudinary Client
 * Configured from environment variables; used by imageService for all
 * product image storage (upload, transform delivery, delete).
 */

const { v2: cloudinary } = require('cloudinary');
const config = require('./index');

cloudinary.config({
  cloud_name: config.externalApis.cloudinary.cloudName,
  api_key: config.externalApis.cloudinary.apiKey,
  api_secret: config.externalApis.cloudinary.apiSecret,
  secure: true,
});

module.exports = cloudinary;
