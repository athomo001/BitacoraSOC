const mongoose = require('mongoose');
require('dotenv').config();
const WorkShift = require('./src/models/WorkShift');
const ChecklistTemplate = require('./src/models/ChecklistTemplate');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
    const shifts = await WorkShift.find({ active: true }).sort({ order: 1, startTime: 1 });
    console.log('Active shifts:', shifts.length);

    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const currentTime = h + ':' + m;
    console.log('Server time:', currentTime);

    // Find current shift
    let matchedShift = null;
    for (const s of shifts) {
        const st = s.startTime, en = s.endTime;
        let inRange;
        if (st < en) { inRange = currentTime >= st && currentTime < en; }
        else { inRange = currentTime >= st || currentTime < en; }
        console.log(`  Shift "${s.name}" (${st}-${en}): inRange=${inRange}`);
        if (inRange && !matchedShift) matchedShift = s;
    }

    console.log('Matched shift:', matchedShift ? matchedShift.name + ' ID:' + matchedShift._id : 'NONE');

    if (matchedShift) {
        // Try finding template assigned to this shift for 'inicio'
        const tplInicio = await ChecklistTemplate.findOne({
            assignedTo: { $elemMatch: { shiftId: matchedShift._id, type: 'inicio' } }
        });
        console.log('Template (inicio) by assignment:', tplInicio ? tplInicio.name : 'NONE');

        // Fallback
        const fallback = await ChecklistTemplate.findOne({ isActive: true });
        console.log('Fallback (isActive:true):', fallback ? fallback.name : 'NONE');
    }

    process.exit(0);
}).catch(err => { console.error(err); process.exit(1); });
