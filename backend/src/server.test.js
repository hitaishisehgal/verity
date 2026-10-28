process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-verity-only';
import { beforeAll, afterAll, beforeEach, afterEach, test, expect, jest } from '@jest/globals';
import request from 'supertest';
import mongoose from 'mongoose';
import fs from 'node:fs/promises';
let app, User, Assignment, Submission, agentA, agentB, agentStudentA, agentStudentB;
async function register(agent, name, email, role) {
  const response = await agent.post('/api/auth/register').send({name,email,password:'secure-pass-123',role});
  expect(response.status).toBe(201);
  expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
  expect(response.body.data.user).not.toHaveProperty('password');
  return response.body.data.user;
}
jest.setTimeout(120000);
beforeAll(async () => {
  ({ app, User, Assignment, Submission } = await import('./server.js'));
  await mongoose.connect('mongodb://127.0.0.1:27017/verity_test');
});
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Assignment.deleteMany({}), Submission.deleteMany({})]);
  agentA=request.agent(app);agentB=request.agent(app);agentStudentA=request.agent(app);agentStudentB=request.agent(app);
  await register(agentA,'Prof One','prof1@example.edu','PROFESSOR');
  await register(agentB,'Prof Two','prof2@example.edu','PROFESSOR');
  await register(agentStudentA,'Student One','student1@example.edu','STUDENT');
  await register(agentStudentB,'Student Two','student2@example.edu','STUDENT');
});
afterEach(async () => {
  const files=await Submission.find({},'filePath');
  await Promise.all(files.map(s=>fs.unlink(s.filePath).catch(()=>{})));
});
afterAll(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });

test('requires auth and rejects student assignment creation', async()=>{
  expect((await request(app).get('/api/assignments')).status).toBe(401);
  expect((await agentStudentA.post('/api/assignments').send({title:'No',programmingLanguage:'JAVA',deadline:new Date().toISOString()})).status).toBe(403);
});
test('limits assignment management to its professor and allows edits/close',async()=>{
  const created=await agentA.post('/api/assignments').send({title:'Loops',programmingLanguage:'JAVA',deadline:new Date(Date.now()+86400000).toISOString()});
  expect(created.status).toBe(201);
  const id=created.body.data._id;
  expect((await agentB.put('/api/assignments/'+id).send({title:'Hijack'})).status).toBe(404);
  expect((await agentStudentA.get('/api/assignments')).body.data).toHaveLength(1);
  expect((await agentA.put('/api/assignments/'+id).send({title:'Loops revised'})).body.data.title).toBe('Loops revised');
  expect((await agentA.patch('/api/assignments/'+id+'/close')).body.data.status).toBe('CLOSED');
});
test('isolates source files, detects duplicates, and versions student uploads',async()=>{
  const a=(await agentA.post('/api/assignments').send({title:'Upload',programmingLanguage:'JAVA',deadline:new Date(Date.now()+3600000).toISOString()})).body.data;
  const body=Buffer.from('public class Main { public static void main(String[] args) { int total = 4 + 5; System.out.println(total); } }');
  const first=await agentStudentA.post('/api/assignments/'+a._id+'/submissions').attach('file',body,{filename:'Main.java',contentType:'text/x-java-source'});
  expect(first.status).toBe(201);expect(first.body.data).not.toHaveProperty('filePath');
  const duplicate=await agentStudentA.post('/api/assignments/'+a._id+'/submissions').attach('file',body,{filename:'renamed.java',contentType:'text/x-java-source'});
  expect(duplicate.status).toBe(200);
  const second=await agentStudentA.post('/api/assignments/'+a._id+'/submissions').attach('file',Buffer.from(body.toString().replace('4 + 5','4 + 6')),{filename:'Main.java',contentType:'text/x-java-source'});
  expect(second.body.data.version).toBe(2);
  const firstId=first.body.data._id;
  expect((await agentStudentB.get('/api/submissions/'+firstId)).status).toBe(404);
  const listed=await agentStudentA.get('/api/assignments/'+a._id+'/submissions');
  expect(listed.body.data).toHaveLength(2);
  expect(listed.body.data[0]).not.toHaveProperty('filePath');
  await agentStudentB.post('/api/assignments/'+a._id+'/submissions').attach('file',body,{filename:'Other.java',contentType:'text/x-java-source'});
  const report=await agentA.post('/api/assignments/'+a._id+'/analyze').send({threshold:1});
  expect(report.status).toBe(200);
  expect(report.body.data.pairs[0].studentNameA).toEqual(expect.any(String));
  expect(report.body.data.pairs[0].studentNameB).toEqual(expect.any(String));
  const history=await agentA.get('/api/assignments/'+a._id+'/analyses');expect(history.body.data).toHaveLength(1);
  const csv=await agentA.get('/api/assignments/'+a._id+'/report.csv');expect(csv.status).toBe(200);expect(csv.text).toContain('Student One');expect(csv.text).toContain('Student Two');
});
test('flags late work using server time and rejects files for the wrong language',async()=>{
  const a=(await agentA.post('/api/assignments').send({title:'Late work',programmingLanguage:'PYTHON',deadline:new Date(Date.now()-60000).toISOString()})).body.data;
  const upload=await agentStudentA.post('/api/assignments/'+a._id+'/submissions').attach('file',Buffer.from('print(1)'),{filename:'main.py',contentType:'text/x-python'});
  expect(upload.status).toBe(201);expect(upload.body.data.isLate).toBe(true);
  const wrong=await agentStudentB.post('/api/assignments/'+a._id+'/submissions').attach('file',Buffer.from('class Main {}'),{filename:'Main.java',contentType:'text/x-java-source'});
  expect(wrong.status).toBe(400);
});