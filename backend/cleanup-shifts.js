const mongoose = require('mongoose');
require('dotenv').config();
const WorkShift = require('./src/models/WorkShift');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
    // Clean up user-created test shifts
    await WorkShift.deleteMany({ code: { $nin: ['MORNING', 'AFTERNOON', 'NIGHT'] } });
    const remaining = await WorkShift.find({});
    console.log('Remaining shifts:', remaining.length);
    remaining.forEach(s => console.log(`  ${s.name} (${s.code}) ${s.startTime}-${s.endTime} active:${s.active}`));
    process.exit(0);
}).catch(err => { console.error(err); process.exit(1); });
