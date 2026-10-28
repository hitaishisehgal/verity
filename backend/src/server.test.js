process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-for-verity-only';
import { beforeAll, afterAll, beforeEach, afterEach, test, expect, jest } from '@jest/globals';
import request from 'supertest';
import mongoose from 'mongoose';
import fs from 'node:fs/promises';
let app, User, Assignment, Submission, Analysis, AuditLog, agentA, agentB, agentStudentA, agentStudentB;
async function register(agent, name, email, role) {
  const response = await agent.post('/api/auth/register').send({name,email,password:'secure-pass-123',role});
  expect(response.status).toBe(201);
  expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
  expect(response.body.data.user).not.toHaveProperty('password');
  return response.body.data.user;
}
jest.setTimeout(120000);
beforeAll(async () => {
  ({ app, User, Assignment, Submission, Analysis, AuditLog } = await import('./server.js'));
  await mongoose.connect('mongodb://127.0.0.1:27017/verity_test');
});
beforeEach(async () => {
  await Promise.all([User.deleteMany({}), Assignment.deleteMany({}), Submission.deleteMany({}), Analysis.deleteMany({}), AuditLog.deleteMany({})]);
  agentA=request.agent(app);agentB=request.agent(app);agentStudentA=request.agent(app);agentStudentB=request.agent(app);
  await register(agentA,'Prof One','prof1@example.edu','PROFESSOR');
  await register(agentB,'Prof Two','prof2@example.edu','PROFESSOR');
  await register(agentStudentA,'Student One','student1@example.edu','STUDENT');
  await register(agentStudentB,'Student Two','student2@example.edu','STUDENT');
});
afterEach(async () => {
  const files=await Submission.find({},'filePath');
  const users=await User.find({},'+avatarPath');
  await Promise.all([...files.map(s=>fs.unlink(s.filePath).catch(()=>{})),...users.filter(u=>u.avatarPath).map(u=>fs.unlink(u.avatarPath).catch(()=>{}))]);
});
afterAll(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });

test('updates a role-aware profile and securely stores a Multer profile image',async()=>{
  const before=await agentStudentA.get('/api/profile');
  expect(before.status).toBe(200);expect(before.body.data.user.role).toBe('STUDENT');
  const saved=await agentStudentA.put('/api/profile').send({name:'Updated Student',department:'Computer Science',studentId:'STU-204',bio:'Learning Java'});
  expect(saved.body.data.user.name).toBe('Updated Student');
  expect(saved.body.data.user.studentId).toBe('STU-204');
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/G0sAAAAASUVORK5CYII=','base64');
  const uploaded=await agentStudentA.post('/api/profile/avatar').attach('avatar',png,{filename:'avatar.png',contentType:'image/png'});
  expect(uploaded.status).toBe(201);expect(uploaded.body.data.user.avatarUrl).toBe('/api/profile/avatar');
  const image=await agentStudentA.get('/api/profile/avatar');
  expect(image.status).toBe(200);expect(image.headers['content-type']).toContain('image/png');
  expect((await agentStudentB.get('/api/profile/avatar')).status).toBe(404);
  const removed=await agentStudentA.delete('/api/profile/avatar');
  expect(removed.status).toBe(200);expect(removed.body.data.user.avatarUrl).toBeNull();
  expect((await agentStudentA.get('/api/profile/avatar')).status).toBe(404);
  const invalid=await agentStudentB.post('/api/profile/avatar').attach('avatar',Buffer.from('not an image'),{filename:'avatar.png',contentType:'image/png'});
  expect(invalid.status).toBe(400);
});test('requires auth and rejects student assignment creation', async()=>{
  expect((await request(app).get('/api/assignments')).status).toBe(401);
  expect((await agentStudentA.post('/api/assignments').send({title:'No',programmingLanguage:'JAVA',deadline:new Date().toISOString()})).status).toBe(403);
  expect((await agentStudentA.get('/api/dashboard/summary')).status).toBe(403);
  const emptySummary=await agentA.get('/api/dashboard/summary');
  expect(emptySummary.status).toBe(200);
  expect(emptySummary.body.data).toEqual({assignmentCount:0,openAssignmentCount:0,submissionCount:0,toReviewCount:0});
});
test('limits assignment management to its professor and allows edits, close, and reopen',async()=>{
  const created=await agentA.post('/api/assignments').send({title:'Loops',programmingLanguage:'JAVA',deadline:new Date(Date.now()+86400000).toISOString()});
  expect(created.status).toBe(201);
  const id=created.body.data._id;
  expect((await agentB.put('/api/assignments/'+id).send({title:'Hijack'})).status).toBe(404);
  expect((await agentStudentA.get('/api/assignments')).body.data).toHaveLength(1);
  expect((await agentA.put('/api/assignments/'+id).send({title:'Loops revised'})).body.data.title).toBe('Loops revised');
  expect((await agentA.patch('/api/assignments/'+id+'/close')).body.data.status).toBe('CLOSED');
  expect((await agentStudentA.get('/api/assignments')).body.data.find(assignment=>assignment._id===id).studentStatus).toBe('CLOSED');
  expect((await agentB.patch('/api/assignments/'+id+'/reopen')).status).toBe(404);
  expect((await agentStudentA.patch('/api/assignments/'+id+'/reopen')).status).toBe(403);
  const reopened=await agentA.patch('/api/assignments/'+id+'/reopen');
  expect(reopened.status).toBe(200);
  expect(reopened.body.data.status).toBe('OPEN');
  expect((await agentStudentA.get('/api/assignments')).body.data.find(assignment=>assignment._id===id)).toBeDefined();
});
test('reports missed deadlines to the professor and the affected student',async()=>{
  const future=await agentA.post('/api/assignments').send({title:'Not due yet',programmingLanguage:'JAVA',deadline:new Date(Date.now()+86400000).toISOString()});
  const futureId=future.body.data._id;
  expect((await agentA.get('/api/assignments/'+futureId+'/missing-students')).body.data.deadlinePassed).toBe(false);
  expect((await agentStudentB.get('/api/assignments')).body.data.find(assignment=>assignment._id===futureId).studentStatus).toBe('PENDING');
  const futureRoster=await agentA.get('/api/assignments/'+futureId+'/students');
  expect(futureRoster.status).toBe(200);
  expect(futureRoster.body.data).toHaveLength(2);
  expect(futureRoster.body.data.every(student=>student.status==='PENDING')).toBe(true);

  const created=await agentA.post('/api/assignments').send({title:'Past deadline',programmingLanguage:'JAVA',deadline:new Date(Date.now()-60000).toISOString()});
  const id=created.body.data._id;
  const late=await agentStudentA.post('/api/assignments/'+id+'/submissions').attach('file',Buffer.from('class Main {}'),{filename:'Main.java',contentType:'text/x-java-source'});
  expect(late.status).toBe(201);
  expect(late.body.data.isLate).toBe(true);

  const professorAssignments=await agentA.get('/api/assignments');
  expect(professorAssignments.body.data.find(assignment=>assignment._id===id).missingCount).toBe(1);
  const studentAssignments=await agentStudentB.get('/api/assignments');
  expect(studentAssignments.body.data.find(assignment=>assignment._id===id).studentStatus).toBe('MISSED');
  const lateStudentAssignments=await agentStudentA.get('/api/assignments');
  expect(lateStudentAssignments.body.data.find(assignment=>assignment._id===id).studentStatus).toBe('LATE');

  const missing=await agentA.get('/api/assignments/'+id+'/missing-students');
  expect(missing.status).toBe(200);
  expect(missing.body.data.deadlinePassed).toBe(true);
  expect(missing.body.data.students.map(student=>student.email)).toEqual(['student2@example.edu']);
  const roster=await agentA.get('/api/assignments/'+id+'/students');
  expect(roster.status).toBe(200);
  expect(roster.body.data).toHaveLength(2);
  expect(roster.body.data.map(student=>[student.email,student.status])).toEqual([
    ['student1@example.edu','LATE'],
    ['student2@example.edu','MISSED'],
  ]);
  expect(roster.body.data[0].submissionCount).toBe(1);
  expect((await agentB.get('/api/assignments/'+id+'/missing-students')).status).toBe(404);
  expect((await agentStudentA.get('/api/assignments/'+id+'/missing-students')).status).toBe(403);
  expect((await agentB.get('/api/assignments/'+id+'/students')).status).toBe(404);
  expect((await agentStudentA.get('/api/assignments/'+id+'/students')).status).toBe(403);
});
test('only the assignment owner can delete an assignment and its submissions',async()=>{
  const created=await agentA.post('/api/assignments').send({title:'Remove me',programmingLanguage:'JAVA',deadline:new Date(Date.now()+86400000).toISOString()});
  const id=created.body.data._id;
  const submission=await agentStudentA.post('/api/assignments/'+id+'/submissions').attach('file',Buffer.from('class Main {}'),{filename:'Main.java',contentType:'text/x-java-source'});
  const file=await Submission.findById(submission.body.data._id);
  expect((await agentB.delete('/api/assignments/'+id)).status).toBe(404);
  expect((await agentStudentA.delete('/api/assignments/'+id)).status).toBe(403);
  const deleted=await agentA.delete('/api/assignments/'+id);
  expect(deleted.status).toBe(200);
  expect(await Assignment.findById(id)).toBeNull();
  expect(await Submission.find({assignment:id})).toHaveLength(0);
  await expect(fs.access(file.filePath)).rejects.toMatchObject({code:'ENOENT'});
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
  expect((await agentStudentA.get('/api/submissions')).body.data).toHaveLength(2);
  expect((await agentA.get('/api/submissions')).status).toBe(403);
  await agentStudentB.post('/api/assignments/'+a._id+'/submissions').attach('file',body,{filename:'Other.java',contentType:'text/x-java-source'});
  const report=await agentA.post('/api/assignments/'+a._id+'/analyze').send({threshold:1});
  expect(report.status).toBe(200);
  expect(report.body.data.pairs[0].studentNameA).toEqual(expect.any(String));
  expect(report.body.data.pairs[0].studentNameB).toEqual(expect.any(String));
  expect(report.body.data.pairs[0].commonTokenSequences.length).toBeGreaterThan(0);
  const history=await agentA.get('/api/assignments/'+a._id+'/analyses');expect(history.body.data).toHaveLength(1);
  const csv=await agentA.get('/api/assignments/'+a._id+'/report.csv');expect(csv.status).toBe(200);expect(csv.text).toContain('Student One');expect(csv.text).toContain('Student Two');
});
test('stores a professor-provided template and excludes it from pair matching',async()=>{
  const template='public class Main { public static void main ( String [ ] args ) { System . out . println ( "starter" ) ; } }';
  const assignment=await agentA.post('/api/assignments').send({title:'Starter code',programmingLanguage:'JAVA',deadline:new Date(Date.now()+3600000).toISOString(),baseCodeTemplate:template});
  expect(assignment.status).toBe(201);
  expect(assignment.body.data.baseCodeTemplate).toBe(template);
  const withoutTemplate=await agentA.post('/api/assignments').send({title:'No template',programmingLanguage:'JAVA',deadline:new Date(Date.now()+3600000).toISOString()});
  expect((await agentB.put('/api/assignments/'+assignment.body.data._id).send({baseCodeTemplate:template})).status).toBe(404);
  const updated=await agentA.put('/api/assignments/'+withoutTemplate.body.data._id).send({baseCodeTemplate:template});
  expect(updated.body.data.baseCodeTemplate).toBe(template);
  const invalid=await agentA.put('/api/assignments/'+assignment.body.data._id).send({baseCodeTemplate:42});
  expect(invalid.status).toBe(400);

  const common='public static int calculate ( int value ) { int result = value * 7 + 4 ; return result ; }';
  const sourceA=template+' '+common+' int extraA = 1 ; int extraB = 2 ; int extraC = 3 ;';
  const sourceB=template+' '+common+' int uniqueX = 8 ; int uniqueY = 9 ; int uniqueZ = 10 ;';
  for(const [agent,source,name] of [[agentStudentA,sourceA,'A.java'],[agentStudentB,sourceB,'B.java']]){
    const uploaded=await agent.post('/api/assignments/'+assignment.body.data._id+'/submissions').attach('file',Buffer.from(source),{filename:name,contentType:'text/x-java-source'});
    expect(uploaded.status).toBe(201);
  }
  const report=await agentA.post('/api/assignments/'+assignment.body.data._id+'/analyze').send({threshold:1});
  expect(report.status).toBe(200);
  expect(report.body.data.pairs[0].similarity).toBeLessThan(100);
  expect(report.body.data.pairs[0].commonTokenSequences.length).toBeGreaterThan(0);
});
test('professors can audit overrides only for pairs in their latest report',async()=>{
  const assignment=(await agentA.post('/api/assignments').send({title:'Override review',programmingLanguage:'JAVA',deadline:new Date(Date.now()+3600000).toISOString()})).body.data;
  for(const [agent,name] of [[agentStudentA,'A.java'],[agentStudentB,'B.java']]){
    await agent.post('/api/assignments/'+assignment._id+'/submissions').attach('file',Buffer.from('public class Main { int compute ( int value ) { return value * 2 + 3 ; } }'),{filename:name,contentType:'text/x-java-source'});
  }
  const analysis=await agentA.post('/api/assignments/'+assignment._id+'/analyze').send({threshold:1});
  expect(analysis.status).toBe(200);
  const pair=analysis.body.data.pairs[0];
  const summary=await agentA.get('/api/dashboard/summary');
  expect(summary.body.data).toEqual({assignmentCount:1,openAssignmentCount:1,submissionCount:2,toReviewCount:1});
  const payload={assignmentId:assignment._id,studentA:pair.studentA,studentB:pair.studentB,action:'DISMISSED',reason:'Reviewed in context'};
  expect((await agentStudentA.post('/api/reports/override').send(payload)).status).toBe(403);
  expect((await agentB.post('/api/reports/override').send(payload)).status).toBe(404);
  const saved=await agentA.post('/api/reports/override').send(payload);
  expect(saved.status).toBe(201);
  expect(saved.body.data.action).toBe('DISMISSED');
  expect(await AuditLog.countDocuments({assignment:assignment._id})).toBe(1);
  const reports=await agentA.get('/api/assignments/'+assignment._id+'/analyses');
  expect(reports.body.data[0].pairs[0].override.action).toBe('DISMISSED');
  expect(reports.body.data[0].pairs[0].override.reason).toBe('Reviewed in context');
  expect((await agentA.get('/api/dashboard/summary')).body.data.toReviewCount).toBe(0);
  const flagged=await agentA.post('/api/reports/override').send({...payload,action:'FLAGGED',reason:'Keep flagged'});
  expect(flagged.status).toBe(201);
  expect((await agentA.get('/api/dashboard/summary')).body.data.toReviewCount).toBe(1);
  const invalid=await agentA.post('/api/reports/override').send({...payload,action:'APPROVED'});
  expect(invalid.status).toBe(400);
});
test('flags late work using server time and rejects files for the wrong language',async()=>{
  const a=(await agentA.post('/api/assignments').send({title:'Late work',programmingLanguage:'PYTHON',deadline:new Date(Date.now()-60000).toISOString()})).body.data;
  const upload=await agentStudentA.post('/api/assignments/'+a._id+'/submissions').attach('file',Buffer.from('print(1)'),{filename:'main.py',contentType:'text/x-python'});
  expect(upload.status).toBe(201);expect(upload.body.data.isLate).toBe(true);
  const wrong=await agentStudentB.post('/api/assignments/'+a._id+'/submissions').attach('file',Buffer.from('class Main {}'),{filename:'Main.java',contentType:'text/x-java-source'});
  expect(wrong.status).toBe(400);
});