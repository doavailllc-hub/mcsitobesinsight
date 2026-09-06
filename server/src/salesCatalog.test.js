import test from 'node:test';
import assert from 'node:assert/strict';
import { registerSalesCatalog, validateSalesperson, saveInvoiceSalesperson } from './salesCatalog.js';

test('salesperson must belong to the invoice company', async () => {
  assert.equal(await validateSalesperson(() => { throw new Error('Unexpected query'); },2,''), null);
  await assert.rejects(validateSalesperson(async () => [],2,9), {statusCode:400});
  assert.deepEqual(await validateSalesperson(async (sql,args) => {
    assert.deepEqual(args,[9,2]); return [{id:9,name:'Alex'}];
  },2,9), {id:9,name:'Alex'});
});

test('salesperson assignment and removal use the invoice transaction', async () => {
  const calls=[]; const conn={query:async (...args) => calls.push(args)};
  await saveInvoiceSalesperson(conn,7,{id:9,name:'Alex'});
  assert.deepEqual(calls[0][1],[7,9,'Alex']);
  await saveInvoiceSalesperson(conn,7,null);
  assert.match(calls[1][0],/^DELETE/); assert.deepEqual(calls[1][1],[7]);
});

function setup(q) {
  const routes={};
  const app=Object.fromEntries(['get','post','put'].map(method => [method,(path,permission,handler) => {routes[method+path]={permission,handler};}]));
  registerSalesCatalog(app,{q,safe:fn=>fn,requireSalesPermission:key=>key,hasEffectivePermission:(access,key,id)=>id===2,companyIdsFromAccess:()=>[2],audit:async()=>{}});
  const response={statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}};
  return {routes,response};
}

test('catalog rejects unauthorized company reads and writes before querying',async()=>{
  const {routes,response}=setup(async()=>{throw new Error('Unexpected query');});
  await assert.rejects(routes['get/api/sales-catalog'].handler({query:{company_id:99}},response),{statusCode:403});
  await assert.rejects(routes['post/api/sales-catalog/items'].handler({body:{company_id:99,name:'Item'}},response),{statusCode:403});
});

test('catalog validates item category and monetary values',async()=>{
  const {routes,response}=setup(async()=>[]);const handler=routes['post/api/sales-catalog/items'].handler;
  await assert.rejects(handler({body:{company_id:2,name:'Item',category_id:99,unit_price:5}},response),{statusCode:400});
  for (const invalid of [{unit_price:-1},{unit_price:5,tax_rate:101},{unit_price:'abc'}]) {
    await assert.rejects(handler({body:{company_id:2,name:'Item',...invalid}},response),{statusCode:400});
  }
});

test('catalog creates items and reports duplicate names',async()=>{
  const calls=[];const {routes,response}=setup(async(sql,args)=>{calls.push([sql,args]);return {insertId:12};});
  const handler=routes['post/api/sales-catalog/items'].handler;
  await handler({body:{company_id:2,name:'Service',unit_price:100,tax_rate:5}},response);
  assert.equal(response.statusCode,201);assert.deepEqual(response.body,{id:12});
  assert.deepEqual(calls[0][1],[2,'Service',null,'',100,5]);
  const duplicate=setup(async()=>{throw Object.assign(new Error('duplicate'),{code:'ER_DUP_ENTRY'});});
  await duplicate.routes['post/api/sales-catalog/categories'].handler({body:{company_id:2,name:'Services'}},duplicate.response);
  assert.equal(duplicate.response.statusCode,409);
});

test('catalog edits are scoped to their existing company',async()=>{
  const {routes,response}=setup(async()=>[]);
  await routes['put/api/sales-catalog/people/:id'].handler({body:{company_id:2,name:'Alex'},params:{id:9}},response);
  assert.equal(response.statusCode,404);
  assert.equal(routes['put/api/sales-catalog/people/:id'].permission,'finance.edit');
  assert.equal(routes['post/api/sales-catalog/people'].permission,'finance.create');
});
