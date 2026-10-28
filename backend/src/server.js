import express from 'express';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokenize, fingerprints, compare } from './services/plagiarism/similarity.js';
dotenv.config();
const jwtSecret=process.env.JWT_SECRET;
if(!jwtSecret&&process.env.NODE_ENV!=='test')throw new Error('JWT_SECRET must be configured in backend/.env');
const app=express(), root=path.dirname(fileURLToPath(import.meta.url));
app.use(cors({origin:process.env.FRONTEND_URL||'http://localhost:5174',credentials:true}));
app.use(express.json({limit:'1mb'})); app.use(cookieParser());
for (const method of ["get","post","put","patch","delete"]) {
  const original=app[method].bind(app);
  app[method]=(...args)=>original(...args.map(handler=>typeof handler==="function"&&handler.constructor.name==="AsyncFunction"?(req,res,next)=>Promise.resolve(handler(req,res,next)).catch(next):handler));
}
const User=mongoose.model('User',new mongoose.Schema({name:{type:String,required:true,trim:true},email:{type:String,unique:true,required:true,lowercase:true,trim:true},password:{type:String,required:true,select:false},role:{type:String,enum:['PROFESSOR','STUDENT'],required:true},department:{type:String,default:'',maxlength:100},bio:{type:String,default:'',maxlength:500},studentId:{type:String,default:'',maxlength:50},avatarFilename:{type:String,default:''},avatarMimeType:{type:String,default:''},avatarPath:{type:String,default:'',select:false}},{timestamps:true}));const Assignment=mongoose.model('Assignment',new mongoose.Schema({title:{type:String,required:true},description:String,baseCodeTemplate:{type:String,default:'',maxlength:50000},programmingLanguage:{type:String,enum:['JAVA','PYTHON'],required:true},professor:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true},deadline:{type:Date,required:true},status:{type:String,enum:['OPEN','CLOSED'],default:'OPEN'}},{timestamps:true}));
const Submission=mongoose.model('Submission',new mongoose.Schema({assignment:{type:mongoose.Schema.Types.ObjectId,ref:'Assignment',required:true},student:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true},version:Number,originalFilename:String,storedFilename:String,filePath:String,programmingLanguage:String,submittedAt:Date,isLate:Boolean,hash:String},{timestamps:true}));
const Analysis=mongoose.model('Analysis',new mongoose.Schema({assignment:{type:mongoose.Schema.Types.ObjectId,ref:'Assignment'},requestedBy:{type:mongoose.Schema.Types.ObjectId,ref:'User'},threshold:Number,pairs:Array,createdAt:{type:Date,default:Date.now}}));
const AuditLog=mongoose.model('AuditLog',new mongoose.Schema({assignment:{type:mongoose.Schema.Types.ObjectId,ref:'Assignment',required:true,index:true},professor:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true},studentA:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true},studentB:{type:mongoose.Schema.Types.ObjectId,ref:'User',required:true},action:{type:String,enum:['DISMISSED','FLAGGED'],required:true},reason:{type:String,default:'',maxlength:500}},{timestamps:true}));
const safe=u=>({id:u._id,name:u.name,email:u.email,role:u.role,department:u.department||'',bio:u.bio||'',studentId:u.studentId||'',avatarUrl:u.avatarFilename?'/api/profile/avatar':null});
const fail=(res,status,message)=>res.status(status).json({success:false,message});
const tokenCookie=(res,t)=>res.cookie('verity_token',t,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:7*864e5});
async function auth(req,res,next){try{const t=req.cookies.verity_token;if(!t) return fail(res,401,'Authentication required');const p=jwt.verify(t,jwtSecret);const u=await User.findById(p.sub).select('+avatarPath');if(!u)return fail(res,401,'Authentication required');req.user=u;next()}catch{return fail(res,401,'Authentication required')}}
const role=r=>(req,res,next)=>req.user.role===r?next():fail(res,403,'Access denied');
const owned=async(a,u)=>String(a.professor)===String(u._id);
const pairKey=(studentA,studentB)=>[String(studentA),String(studentB)].sort().join(':');
app.post('/api/auth/register',async(req,res)=>{try{const{name,email,password,role:r}=req.body;if(!name||!email||!/^.+@.+\..+$/.test(email)||!password||password.length<8||!['PROFESSOR','STUDENT'].includes(r))return fail(res,400,'Provide name, valid email, password (8+ characters), and role');const u=await User.create({name:name.trim(),email:email.trim().toLowerCase(),password:await bcrypt.hash(password,12),role:r});tokenCookie(res,jwt.sign({sub:u.id},jwtSecret,{expiresIn:'7d'}));res.status(201).json({success:true,data:{user:safe(u)}})}catch(e){return fail(res,e.code===11000?409:500,e.code===11000?'Email already registered':'Unable to register')}});
app.post('/api/auth/login',async(req,res)=>{const u=await User.findOne({email:String(req.body.email||'').toLowerCase()}).select('+password');if(!u||!await bcrypt.compare(req.body.password||'',u.password))return fail(res,401,'Invalid email or password');tokenCookie(res,jwt.sign({sub:u.id},jwtSecret,{expiresIn:'7d'}));res.json({success:true,data:{user:safe(u)}})});
app.post('/api/auth/logout',(req,res)=>{res.clearCookie('verity_token',{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production'});res.json({success:true,data:{}})});
app.get('/api/auth/me',auth,(req,res)=>res.json({success:true,data:{user:safe(req.user)}}));
const profileStorage=multer.diskStorage({destination:(req,file,cb)=>cb(null,profileRoot),filename:(req,file,cb)=>cb(null,'profile_'+crypto.randomUUID()+path.extname(file.originalname).toLowerCase())});
const profileUpload=multer({storage:profileStorage,limits:{fileSize:2*1024*1024},fileFilter:(req,file,cb)=>{const ext=path.extname(file.originalname).toLowerCase(),allowed=(ext==='.jpg'||ext==='.jpeg')&&file.mimetype==='image/jpeg'||ext==='.png'&&file.mimetype==='image/png'||ext==='.webp'&&file.mimetype==='image/webp';cb(allowed?null:new Error('Choose a JPG, PNG, or WebP image'),allowed)}});
app.get('/api/profile',auth,(req,res)=>res.json({success:true,data:{user:safe(req.user)}}));
app.put('/api/profile',auth,async(req,res)=>{const{name,department,bio,studentId}=req.body;if(typeof name!=='string'||!name.trim()||name.trim().length>100||department!==undefined&&(typeof department!=='string'||department.length>100)||bio!==undefined&&(typeof bio!=='string'||bio.length>500)||studentId!==undefined&&(typeof studentId!=='string'||studentId.length>50))return fail(res,400,'Check your name, department, bio, and student ID lengths');req.user.name=name.trim();req.user.department=(department||'').trim();req.user.bio=(bio||'').trim();req.user.studentId=req.user.role==='STUDENT'?(studentId||'').trim():'';await req.user.save();res.json({success:true,data:{user:safe(req.user)}})});
app.post('/api/profile/avatar',auth,profileUpload.single('avatar'),async(req,res)=>{if(!req.file)return fail(res,400,'Select a profile image');const image=await fs.readFile(req.file.path),type=req.file.mimetype,valid=type==='image/png'?image.subarray(0,8).toString('hex')==='89504e470d0a1a0a':type==='image/jpeg'?image[0]===0xff&&image[1]===0xd8&&image[2]===0xff:image.subarray(0,4).toString()==='RIFF'&&image.subarray(8,12).toString()==='WEBP';if(!valid){await fs.unlink(req.file.path);return fail(res,400,'Image contents do not match the selected image format')}const previous=req.user.avatarPath;req.user.avatarFilename=req.file.filename;req.user.avatarMimeType=type;req.user.avatarPath=req.file.path;await req.user.save();if(previous&&path.resolve(previous).startsWith(profileRoot+path.sep))await fs.unlink(previous).catch(()=>{});res.status(201).json({success:true,data:{user:safe(req.user)}})});
app.delete('/api/profile/avatar',auth,async(req,res)=>{const previous=req.user.avatarPath;req.user.avatarFilename='';req.user.avatarMimeType='';req.user.avatarPath='';await req.user.save();if(previous){const imagePath=path.resolve(previous);if(imagePath.startsWith(profileRoot+path.sep)){try{await fs.unlink(imagePath)}catch(error){if(error.code!=='ENOENT')throw error}}}res.json({success:true,data:{user:safe(req.user)}})});
app.get('/api/profile/avatar',auth,async(req,res)=>{if(!req.user.avatarPath||!req.user.avatarMimeType)return fail(res,404,'No profile image uploaded');const imagePath=path.resolve(req.user.avatarPath);if(!imagePath.startsWith(profileRoot+path.sep))return fail(res,404,'Profile image unavailable');res.type(req.user.avatarMimeType).sendFile(imagePath)});
app.get('/api/submissions',auth,role('STUDENT'),async(req,res)=>{const rows=await Submission.find({student:req.user._id}).select('-filePath -storedFilename -hash').populate('assignment','title programmingLanguage deadline status').sort({submittedAt:-1});res.json({success:true,data:rows})});
app.get('/api/dashboard/summary',auth,role('PROFESSOR'),async(req,res)=>{
  const assignments=await Assignment.find({professor:req.user._id}).select('_id status');
  const assignmentIds=assignments.map(assignment=>assignment._id);
  if(!assignmentIds.length)return res.json({success:true,data:{assignmentCount:0,openAssignmentCount:0,submissionCount:0,toReviewCount:0}});
  const [submissionCount,reports,audits]=await Promise.all([
    Submission.countDocuments({assignment:{$in:assignmentIds}}),
    Analysis.find({assignment:{$in:assignmentIds}}).sort({createdAt:-1}),
    AuditLog.find({assignment:{$in:assignmentIds}}).sort({createdAt:-1}),
  ]);
  const latestReports=new Map();
  for(const report of reports)if(!latestReports.has(String(report.assignment)))latestReports.set(String(report.assignment),report);
  const latestOverrides=new Map();
  for(const audit of audits){
    const key=String(audit.assignment)+':'+pairKey(audit.studentA,audit.studentB);
    if(!latestOverrides.has(key))latestOverrides.set(key,audit.action);
  }
  let toReviewCount=0;
  for(const [assignmentId,report] of latestReports)for(const pair of report.pairs){
    const action=latestOverrides.get(assignmentId+':'+pairKey(pair.studentA,pair.studentB));
    if(action==='FLAGGED'||action!=='DISMISSED'&&pair.status==='REVIEW_REQUIRED')toReviewCount++;
  }
  res.json({success:true,data:{
    assignmentCount:assignments.length,
    openAssignmentCount:assignments.filter(assignment=>assignment.status==='OPEN').length,
    submissionCount,
    toReviewCount,
  }});
});
app.get('/api/assignments',auth,async(req,res)=>{
  const professor=req.user.role==='PROFESSOR',query=professor?{professor:req.user._id}:{};
  const rows=await Assignment.find(query).sort({createdAt:-1}),now=new Date();
  if(professor){
    const totalStudents=await User.countDocuments({role:'STUDENT'});
    const overdue=rows.filter(assignment=>assignment.deadline<=now);
    const submitted=overdue.length?await Submission.find({assignment:{$in:overdue.map(assignment=>assignment._id)}}).select('assignment student'):[];
    const submittedStudents=new Map();
    for(const submission of submitted){
      const id=String(submission.assignment);
      if(!submittedStudents.has(id))submittedStudents.set(id,new Set());
      submittedStudents.get(id).add(String(submission.student));
    }
    return res.json({success:true,data:rows.map(assignment=>({...assignment.toObject(),missingCount:assignment.deadline<=now?totalStudents-(submittedStudents.get(String(assignment._id))?.size||0):0}))});
  }
  const submissions=rows.length?await Submission.find({assignment:{$in:rows.map(assignment=>assignment._id)},student:req.user._id}).select('assignment isLate submittedAt').sort({submittedAt:-1}):[];
  const submissionByAssignment=new Map();
  for(const submission of submissions)if(!submissionByAssignment.has(String(submission.assignment)))submissionByAssignment.set(String(submission.assignment),submission);
  res.json({success:true,data:rows.map(assignment=>{
    const submission=submissionByAssignment.get(String(assignment._id));
    const studentStatus=submission?(submission.isLate?'LATE':'SUBMITTED'):assignment.deadline<=now?'MISSED':assignment.status==='CLOSED'?'CLOSED':'PENDING';
    return {...assignment.toObject(),studentStatus};
  })});
});
app.post('/api/assignments',auth,role('PROFESSOR'),async(req,res)=>{const{title,description,baseCodeTemplate='',programmingLanguage,deadline}=req.body;if(!title||!['JAVA','PYTHON'].includes(programmingLanguage)||!deadline||isNaN(Date.parse(deadline))||typeof baseCodeTemplate!=='string'||baseCodeTemplate.length>50000)return fail(res,400,'Provide valid assignment details and a base code template under 50,000 characters');const a=await Assignment.create({title,description,baseCodeTemplate,programmingLanguage,deadline,professor:req.user._id});res.status(201).json({success:true,data:a})});
app.get('/api/assignments/:id',auth,async(req,res)=>{const a=await Assignment.findById(req.params.id);if(!a||req.user.role==='PROFESSOR'&&!await owned(a,req.user)||req.user.role==='STUDENT'&&a.status!=='OPEN')return fail(res,404,'Assignment not found');res.json({success:true,data:a})});
app.put('/api/assignments/:id',auth,role('PROFESSOR'),async(req,res)=>{const a=await Assignment.findById(req.params.id);if(!a||!await owned(a,req.user))return fail(res,404,'Assignment not found');if(req.body.baseCodeTemplate!==undefined&&(typeof req.body.baseCodeTemplate!=='string'||req.body.baseCodeTemplate.length>50000))return fail(res,400,'Base code template must be a string under 50,000 characters');for(const k of ['title','description','deadline','programmingLanguage','baseCodeTemplate'])if(req.body[k]!==undefined)a[k]=req.body[k];await a.save();res.json({success:true,data:a})});
app.patch('/api/assignments/:id/close',auth,role('PROFESSOR'),async(req,res)=>{const a=await Assignment.findById(req.params.id);if(!a||!await owned(a,req.user))return fail(res,404,'Assignment not found');a.status='CLOSED';await a.save();res.json({success:true,data:a})});
app.patch('/api/assignments/:id/reopen',auth,role('PROFESSOR'),async(req,res)=>{const a=await Assignment.findById(req.params.id);if(!a||!await owned(a,req.user))return fail(res,404,'Assignment not found');a.status='OPEN';await a.save();res.json({success:true,data:a})});
app.get('/api/assignments/:id/missing-students',auth,role('PROFESSOR'),async(req,res)=>{
  const assignment=await Assignment.findById(req.params.id);
  if(!assignment||!await owned(assignment,req.user))return fail(res,404,'Assignment not found');
  if(assignment.deadline>new Date())return res.json({success:true,data:{deadlinePassed:false,students:[]}});
  const submissions=await Submission.distinct('student',{assignment:assignment._id});
  const students=await User.find({role:'STUDENT',_id:{$nin:submissions}}).select('name email studentId').sort({name:1});
  res.json({success:true,data:{deadlinePassed:true,students}});
});
app.get('/api/assignments/:id/students',auth,role('PROFESSOR'),async(req,res)=>{
  const assignment=await Assignment.findById(req.params.id);
  if(!assignment||!await owned(assignment,req.user))return fail(res,404,'Assignment not found');
  const [students,submissions]=await Promise.all([
    User.find({role:'STUDENT'}).select('name email studentId').sort({name:1}),
    Submission.find({assignment:assignment._id}).select('student submittedAt originalFilename'),
  ]);
  const submissionsByStudent=new Map();
  for(const submission of submissions){
    const key=String(submission.student);
    const current=submissionsByStudent.get(key)||{count:0,latest:null,submittedOnTime:false};
    current.count++;
    if(!current.latest||submission.submittedAt>current.latest.submittedAt)current.latest=submission;
    if(submission.submittedAt<=assignment.deadline)current.submittedOnTime=true;
    submissionsByStudent.set(key,current);
  }
  const now=new Date();
  res.json({success:true,data:students.map(student=>{
    const submission=submissionsByStudent.get(String(student._id));
    const status=submission?(submission.submittedOnTime?'SUBMITTED':'LATE'):assignment.deadline<=now?'MISSED':assignment.status==='CLOSED'?'CLOSED':'PENDING';
    return {...student.toObject(),status,submittedAt:submission?.latest.submittedAt||null,latestFilename:submission?.latest.originalFilename||null,submissionCount:submission?.count||0};
  })});
});
const uploadRoot=path.resolve(process.env.UPLOAD_DIR||path.join(root,'../uploads'));await fs.mkdir(uploadRoot,{recursive:true});
app.delete('/api/assignments/:id',auth,role('PROFESSOR'),async(req,res)=>{const assignment=await Assignment.findById(req.params.id);if(!assignment||!await owned(assignment,req.user))return fail(res,404,'Assignment not found');const submissions=await Submission.find({assignment:assignment._id});const files=submissions.map(submission=>submission.filePath).filter(Boolean).map(file=>path.resolve(file));if(files.some(file=>!file.startsWith(uploadRoot+path.sep)))return fail(res,500,'Unable to safely delete assignment files');await Promise.all(files.map(async file=>{try{await fs.unlink(file)}catch(error){if(error.code!=='ENOENT')throw error}}));await Submission.deleteMany({assignment:assignment._id});await Analysis.deleteMany({assignment:assignment._id});await assignment.deleteOne();res.json({success:true,data:{id:assignment.id}})});
const profileRoot=path.resolve(uploadRoot,'profiles');await fs.mkdir(profileRoot,{recursive:true});
const storage=multer.diskStorage({destination:(req,file,cb)=>cb(null,uploadRoot),filename:(req,file,cb)=>cb(null,crypto.randomUUID()+'-'+Date.now()+path.extname(file.originalname).toLowerCase())});
const upload=multer({storage,limits:{fileSize:1024*1024},fileFilter:(req,f,cb)=>{const ext=path.extname(f.originalname).toLowerCase(),ok=ext==='.java'&&f.mimetype==='text/x-java-source'||ext==='.py'&&['text/x-python','text/plain','application/x-python-code'].includes(f.mimetype);cb(ok?null:new Error('Only Java or Python source files are allowed'),ok)}});
app.post('/api/assignments/:id/submissions',auth,role('STUDENT'),upload.single('file'),async(req,res)=>{try{const a=await Assignment.findById(req.params.id);if(!a||a.status!=='OPEN')return fail(res,404,'Open assignment not found');if(!req.file)return fail(res,400,'Source file is required');const ext=path.extname(req.file.originalname).toLowerCase(),lang=ext==='.java'?'JAVA':'PYTHON';if(lang!==a.programmingLanguage){await fs.unlink(req.file.path);return fail(res,400,'File language does not match assignment')}const buf=await fs.readFile(req.file.path);if(!buf.length){await fs.unlink(req.file.path);return fail(res,400,'Empty source file')}const hash=crypto.createHash('sha256').update(buf).digest('hex'),same=await Submission.findOne({assignment:a._id,student:req.user._id,hash});if(same){await fs.unlink(req.file.path);return res.status(200).json({success:true,data:same,message:'Identical file already submitted'})}const version=(await Submission.countDocuments({assignment:a._id,student:req.user._id}))+1,s=await Submission.create({assignment:a._id,student:req.user._id,version,originalFilename:path.basename(req.file.originalname),storedFilename:req.file.filename,filePath:req.file.path,programmingLanguage:lang,submittedAt:new Date(),isLate:new Date()>a.deadline,hash});res.status(201).json({success:true,data:{_id:s._id,assignment:s.assignment,version:s.version,originalFilename:s.originalFilename,programmingLanguage:s.programmingLanguage,submittedAt:s.submittedAt,isLate:s.isLate}})}catch(e){if(req.file)await fs.unlink(req.file.path).catch(()=>{});throw e}});
app.get('/api/assignments/:id/submissions',auth,async(req,res)=>{const a=await Assignment.findById(req.params.id);if(!a||req.user.role==='PROFESSOR'&&!await owned(a,req.user))return fail(res,404,'Assignment not found');const q={assignment:a._id};if(req.user.role==='STUDENT')q.student=req.user._id;const rows=await Submission.find(q).select('-filePath -storedFilename -hash').populate('student','name email').sort({submittedAt:-1});res.json({success:true,data:rows})});
app.get('/api/submissions/:id/versions',auth,async(req,res)=>{const s=await Submission.findById(req.params.id).populate('assignment');if(!s||req.user.role==='STUDENT'&&String(s.student)!==String(req.user._id)||req.user.role==='PROFESSOR'&&!await owned(s.assignment,req.user))return fail(res,404,'Submission not found');const rows=await Submission.find({assignment:s.assignment._id,student:s.student}).select('-filePath -storedFilename -hash').sort({version:1});res.json({success:true,data:rows})});
app.get('/api/submissions/:id',auth,async(req,res)=>{const s=await Submission.findById(req.params.id).populate('assignment');if(!s||req.user.role==='STUDENT'&&String(s.student)!==String(req.user._id)||req.user.role==='PROFESSOR'&&!await owned(s.assignment,req.user))return fail(res,404,'Submission not found');const p=path.resolve(s.filePath);if(!p.startsWith(uploadRoot+path.sep))return fail(res,404,'File unavailable');res.download(p,s.originalFilename)});
app.post('/api/assignments/:id/analyze',auth,role('PROFESSOR'),async(req,res)=>{
  const assignment=await Assignment.findById(req.params.id);
  if(!assignment||!await owned(assignment,req.user))return fail(res,404,'Assignment not found');
  const threshold=Number(req.body.threshold??40);
  if(!Number.isFinite(threshold)||threshold<1||threshold>100)return fail(res,400,'Threshold must be between 1 and 100');
  const all=await Submission.find({assignment:assignment._id}).populate('student','name email').sort({submittedAt:-1});
  const latest=new Map();
  for(const submission of all)if(!latest.has(String(submission.student._id)))latest.set(String(submission.student._id),submission);
  const items=await Promise.all([...latest.values()].map(async submission=>{
    const filePath=path.resolve(submission.filePath||'');
    if(!submission.filePath||!filePath.startsWith(uploadRoot+path.sep))throw new Error('Submission file is outside the configured upload directory');
    return {submission,source:await fs.readFile(filePath,'utf8')};
  }));
  const pairs=[];
  for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){
    const {submission:submissionA,source:sourceA}=items[i];
    const {submission:submissionB,source:sourceB}=items[j];
    const metrics=compare(sourceA,sourceB,assignment.baseCodeTemplate||'');
    pairs.push({
      submissionA:submissionA._id,
      submissionB:submissionB._id,
      studentA:submissionA.student._id,
      studentB:submissionB.student._id,
      studentNameA:submissionA.student.name,
      studentNameB:submissionB.student.name,
      ...metrics,
      status:metrics.similarity>=threshold?'REVIEW_REQUIRED':'NOT_FLAGGED',
    });
  }
  const report=await Analysis.create({assignment:assignment._id,requestedBy:req.user._id,threshold,pairs});
  res.json({success:true,data:report});
});
app.post('/api/reports/override',auth,role('PROFESSOR'),async(req,res)=>{
  const {assignmentId,studentA,studentB,action,reason=''}=req.body;
  if(!mongoose.isValidObjectId(assignmentId)||!mongoose.isValidObjectId(studentA)||!mongoose.isValidObjectId(studentB)||String(studentA)===String(studentB)||!['DISMISSED','FLAGGED'].includes(action)||typeof reason!=='string'||reason.length>500)return fail(res,400,'Provide a valid assignment, two students, action, and reason under 500 characters');
  const assignment=await Assignment.findById(assignmentId);
  if(!assignment||!await owned(assignment,req.user))return fail(res,404,'Assignment not found');
  const report=await Analysis.findOne({assignment:assignment._id}).sort({createdAt:-1});
  if(!report||!report.pairs.some(pair=>pairKey(pair.studentA,pair.studentB)===pairKey(studentA,studentB)))return fail(res,404,'Student pair not found in the latest analysis');
  const students=await User.find({_id:{$in:[studentA,studentB]},role:'STUDENT'}).select('_id');
  if(students.length!==2)return fail(res,400,'Both pair members must be students');
  const audit=await AuditLog.create({assignment:assignment._id,professor:req.user._id,studentA,studentB,action,reason:reason.trim()});
  res.status(201).json({success:true,data:audit});
});
app.get('/api/assignments/:id/analyses',auth,role('PROFESSOR'),async(req,res)=>{
  const assignment=await Assignment.findById(req.params.id);
  if(!assignment||!await owned(assignment,req.user))return fail(res,404,'Assignment not found');
  const reports=await Analysis.find({assignment:assignment._id}).sort({createdAt:-1});
  const overrides=await AuditLog.find({assignment:assignment._id}).sort({createdAt:-1});
  const latestOverride=new Map();
  for(const override of overrides){
    const key=pairKey(override.studentA,override.studentB);
    if(!latestOverride.has(key))latestOverride.set(key,{action:override.action,reason:override.reason,createdAt:override.createdAt});
  }
  res.json({success:true,data:reports.map(report=>({
    ...report.toObject(),
    pairs:report.pairs.map(pair=>({...pair,override:latestOverride.get(pairKey(pair.studentA,pair.studentB))||null})),
  }))});
});
app.get('/api/assignments/:id/report.csv',auth,role('PROFESSOR'),async(req,res)=>{const a=await Assignment.findById(req.params.id);if(!a||!await owned(a,req.user))return fail(res,404,'Assignment not found');const r=await Analysis.findOne({assignment:a._id}).sort({createdAt:-1});if(!r)return fail(res,404,'Run an analysis first');const csv=['studentA,studentB,similarity,jaccard,coverageA,coverageB,status',...r.pairs.map(p=>[p.studentNameA||p.studentA,p.studentNameB||p.studentB,p.similarity,p.jaccard,p.coverageA,p.coverageB,p.status].map(x=>'"'+String(x).replaceAll('"','""')+'"').join(','))].join('\n');res.type('text/csv').attachment('verity-report.csv').send(csv)});
app.use((e,req,res,_next)=>{console.error(e);const badInput=e instanceof mongoose.Error.CastError||e instanceof mongoose.Error.ValidationError;const invalidFile=e.message==='Only Java or Python source files are allowed';const status=badInput||invalidFile||e instanceof multer.MulterError?400:500;const message=badInput?'Invalid request data':e instanceof multer.MulterError?'Upload rejected':e.message==='Only Java or Python source files are allowed'?e.message:'Unexpected server error';res.status(status).json({success:false,message})});
const port=process.env.PORT||5001;
if(process.env.NODE_ENV!=='test')mongoose.connect(process.env.MONGODB_URI||'mongodb://127.0.0.1:27017/verity').then(()=>app.listen(port,()=>console.log('Verity API listening on '+port))).catch(e=>{console.error('MongoDB connection failed',e.message);process.exit(1)});
export {app,tokenize,fingerprints,compare,User,Assignment,Submission,Analysis,AuditLog};
