const mongoose = require('mongoose');

const checklistNotificationLogSchema = new mongoose.Schema({
  notificationKey: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    maxlength: 200
  },
  weekId: {
    type: String,
    required: true,
    trim: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['reminder', 'breach'],
    required: true
  },
  status: {
    type: String,
    enum: ['sent', 'skipped', 'error'],
    required: true,
    default: 'sent'
  },
  recipients: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  error: {
    type: String,
    default: ''
  },
  sentAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

checklistNotificationLogSchema.index({ weekId: 1, type: 1, userId: 1 });
checklistNotificationLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ChecklistNotificationLog', checklistNotificationLogSchema);
