require('dotenv').config();
const jwt = require('jsonwebtoken');

function checkKey(name, key) {
    if (!key) {
        console.log(`❌ ${name} is missing`);
        return;
    }
    try {
        const decoded = jwt.decode(key);
        console.log(`✅ ${name}: role='${decoded.role}', iss='${decoded.iss}'`);
    } catch (e) {
        console.log(`❌ ${name} is not a valid JWT`);
    }
}

checkKey('SUPABASE_SERVICE_KEY', process.env.SUPABASE_SERVICE_KEY);
checkKey('SUPABASE_ANON_KEY', process.env.SUPABASE_ANON_KEY);
