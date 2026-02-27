const fs = require('fs');
const filePath = 'backend/src/routes/checklist.js';
let content = fs.readFileSync(filePath, 'utf8');

const target = `const getActiveChecklistSnapshot = async (shiftId = null, templateType = null) => {
  let activeTemplate = null;

  if (shiftId && templateType) {
    activeTemplate = await ChecklistTemplate.findOne({
      assignedTo: { $elemMatch: { shiftId: shiftId, type: templateType } }
    });
  }

  if (!activeTemplate) {
    activeTemplate = await ChecklistTemplate.findOne({ isActive: true });
  }`;

const replacement = `const getActiveChecklistSnapshot = async (shiftId = null, templateType = null) => {
  let activeTemplate = null;

  if (shiftId && templateType) {
    const shift = await WorkShift.findById(shiftId);
    if (shift) {
      if (templateType === 'inicio' && shift.checklistTemplateStartId) {
        activeTemplate = await ChecklistTemplate.findById(shift.checklistTemplateStartId);
      } else if (templateType === 'cierre' && shift.checklistTemplateEndId) {
        activeTemplate = await ChecklistTemplate.findById(shift.checklistTemplateEndId);
      } else if (shift.checklistTemplateId) {
        activeTemplate = await ChecklistTemplate.findById(shift.checklistTemplateId);
      }
    }
  }

  // legacy fallback
  if (!activeTemplate && shiftId && templateType) {
    activeTemplate = await ChecklistTemplate.findOne({
      assignedTo: { $elemMatch: { shiftId: shiftId, type: templateType } }
    });
  }

  if (!activeTemplate) {
    activeTemplate = await ChecklistTemplate.findOne({ isActive: true });
  }`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log('checklist.js patched successfully');
} else {
    console.error('Target content not found in checklist.js');
    process.exit(1);
}
