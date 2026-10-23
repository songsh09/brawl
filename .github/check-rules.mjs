// Firebase에 실제로 적용된 규칙을 읽어서 저장소의 database.rules.json 과 같은지 확인
import { GoogleAuth } from 'google-auth-library';
import fs from 'fs';

const DB = 'https://brawl090417-default-rtdb.asia-southeast1.firebasedatabase.app';
const out = { time: new Date().toISOString(), sha: process.env.GITHUB_SHA, deploy: process.env.DEPLOY_OUTCOME || '' };
try {
  const auth = new GoogleAuth({
    keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/firebase.database', 'https://www.googleapis.com/auth/userinfo.email'],
  });
  const token = await auth.getAccessToken();
  const r = await fetch(DB + '/.settings/rules.json', { headers: { Authorization: 'Bearer ' + token } });
  const txt = await r.text();
  out.http = r.status;
  fs.writeFileSync('live-rules.json', txt);
  const live = JSON.parse(txt);
  const local = JSON.parse(fs.readFileSync('database.rules.json', 'utf8'));
  out.same = JSON.stringify(live) === JSON.stringify(local);
} catch (e) {
  out.error = String(e && e.message || e);
}
fs.writeFileSync('status.json', JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify(out));
