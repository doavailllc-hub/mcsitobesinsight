import jwt from 'jsonwebtoken';
export function auth(req,res,next){const h=req.headers.authorization||'';const token=h.startsWith('Bearer ')?h.slice(7):null;if(!token)return res.status(401).json({message:'Authentication required'});try{req.user=jwt.verify(token,process.env.JWT_SECRET||'dev-secret');next()}catch{return res.status(401).json({message:'Invalid or expired session'})}}
