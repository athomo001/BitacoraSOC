const mongoose = require('mongoose');

const tokenDenylistSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true
  },
  expiresAt: {
    type: Date,
    required: true
  }
});

// TTL index to automatically remove expired tokens from the denylist
tokenDenylistSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('TokenDenylist', tokenDenylistSchema);
