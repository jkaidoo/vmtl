'use strict';
const settings = require('./settings');
const enums = require('./enums');
const { badRequest } = require('../middleware/errorHandler');
const extras = {
 expense_category: ['allowance','toll','repair','accommodation','other'].map(value=>({value,label:value[0].toUpperCase()+value.slice(1)})),
 service_provider: [{value:'KNUST Maintenance',label:'KNUST Maintenance'},{value:'Toyota Ghana',label:'Toyota Ghana'},{value:'other',label:'Other'}],
 station: [{value:'KNUST JP',label:'KNUST JP'},{value:'other',label:'Other'}],
 fuel_type: ['petrol','diesel','electric','hybrid'].map(value=>({value,label:value[0].toUpperCase()+value.slice(1)}))
};
let effective={};
function label(key,value,fallback){return effective[key]?.find(o=>o.value===value)?.label ?? fallback ?? value;}
async function options() {
 const saved = JSON.parse(await settings.get('dropdown_options', '{}'));
 effective={...enums.options,...extras,...saved};
 return effective;
}
async function save(key, items) {
 const all = await options();
 if (!Object.hasOwn(all,key) || key === 'role_type') throw badRequest('Choose a dropdown. Roles are managed on RBAC.');
 if (!Array.isArray(items) || !items.length || items.length>200) throw badRequest('Provide 1–200 choices.');
 const seen = new Set();
 const clean = items.map(item=>{
  if(!item || typeof item!=='object' || Array.isArray(item)) throw badRequest('Each choice needs a value and label.');
  const value=String(item.value||'').trim(), label=String(item.label||'').trim();
  if (/[<>"'|\\\r\n]/.test(value) || !value || value.length>100 || !label || /[|\r\n]/.test(label) || label.length>150 || seen.has(value)) throw badRequest('Choices need unique values and labels.');
  seen.add(value); return {...(key==='vehicle_type'?{group:'Other',seats:5}:{}),...(all[key].find(o=>o.value===value)||{}),value,label};
 });
 // Workflow states and vehicle types retain their keys because application
 // transitions (and the trip-progress animation motif) depend on them.
 if (['request_status','trip_status','vehicle_status','driver_status','org_unit_type','vehicle_type'].includes(key) && (all[key].some(o=>!seen.has(o.value)) || clean.some(o=>!all[key].some(x=>x.value===o.value)))) throw badRequest('These choices can be relabelled, but their keys must be retained.');
 if (['service_provider','station'].includes(key) && !seen.has('other')) throw badRequest('Keep the Other choice.');
 const saved=JSON.parse(await settings.get('dropdown_options','{}')); saved[key]=clean;
 await settings.set('dropdown_options',JSON.stringify(saved)); return options();
}
async function rules(rules, mapping) {
 const all=await options(); const out={...rules};
 for (const [field,key] of Object.entries(mapping)) out[field]={...rules[field],in:all[key].map(o=>o.value)};
 return out;
}
async function resolve(body, field) {
 const value=String(body[field]||'').trim(); const all=await options();
 if (!all[field].some(o=>o.value===value)) throw badRequest('Choose a valid '+field.replaceAll('_',' ')+'.');
 if(value!=='other') return value;
 const name=String(body[field+'_other']||'').trim();
 if(!name || name.length>255) throw badRequest('Enter the name for Other.');
 return name;
}
module.exports={options,save,rules,resolve,label};
