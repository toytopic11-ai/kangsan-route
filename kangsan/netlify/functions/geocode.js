exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const query = event.queryStringParameters?.q;
  if (!query) return { statusCode: 400, headers, body: JSON.stringify({ error: 'q 파라미터 필요' }) };

  const KEY = process.env.KAKAO_REST_KEY;
  if (!KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: 'KAKAO_REST_KEY 미설정' }) };

  const kakaoAddr = async (q) => {
    try {
      const r = await fetch(`https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(q)}&size=1`, { headers: { Authorization: `KakaoAK ${KEY}` } });
      const d = await r.json();
      return d.documents?.length > 0 ? d.documents[0] : null;
    } catch(e) { return null; }
  };

  const kakaoKw = async (q) => {
    try {
      const r = await fetch(`https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(q)}&size=1`, { headers: { Authorization: `KakaoAK ${KEY}` } });
      const d = await r.json();
      return d.documents?.length > 0 ? d.documents[0] : null;
    } catch(e) { return null; }
  };

  const vworld = async (q, type) => {
    try {
      const r = await fetch(`https://api.vworld.kr/req/address?service=address&request=getcoord&version=2.0&crs=epsg:4326&address=${encodeURIComponent(q)}&refine=true&simple=false&format=json&type=${type}&key=F4836B82-0E97-3B99-A518-C4BD1C9E9887`);
      const d = await r.json();
      if (d.response?.status === 'OK' && d.response.result?.point) return d.response.result.point;
      return null;
    } catch(e) { return null; }
  };

  const removeLot = (addr) => addr.replace(/\s+\d+(-\d+)?(\s.*)?$/, '').trim();
  const removeLastUnit = (addr) => { const p = addr.split(' '); return p.length > 2 ? p.slice(0, -1).join(' ') : addr; };

  try {
    let doc, pt;

    doc = await kakaoAddr(query);
    if (doc) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, lat: parseFloat(doc.y), lon: parseFloat(doc.x), src: '카카오주소' }) };

    doc = await kakaoKw(query);
    if (doc) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, lat: parseFloat(doc.y), lon: parseFloat(doc.x), src: '카카오키워드' }) };

    pt = await vworld(query, 'parcel');
    if (pt) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, lat: parseFloat(pt.y), lon: parseFloat(pt.x), src: 'Vworld지번' }) };

    pt = await vworld(query, 'road');
    if (pt) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, lat: parseFloat(pt.y), lon: parseFloat(pt.x), src: 'Vworld도로명' }) };

    const simple = removeLot(query);
    if (simple !== query) {
      doc = await kakaoAddr(simple);
      if (doc) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, lat: parseFloat(doc.y), lon: parseFloat(doc.x), src: '카카오번지제거' }) };

      pt = await vworld(simple, 'parcel');
      if (pt) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, lat: parseFloat(pt.y), lon: parseFloat(pt.x), src: 'Vworld번지제거' }) };
    }

    const region = removeLastUnit(simple);
    if (region !== simple) {
      doc = await kakaoAddr(region);
      if (doc) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, lat: parseFloat(doc.y), lon: parseFloat(doc.x), src: '카카오리단위' }) };

      pt = await vworld(region, 'parcel');
      if (pt) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, lat: parseFloat(pt.y), lon: parseFloat(pt.x), src: 'Vworld리단위' }) };

      doc = await kakaoKw(region);
      if (doc) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, lat: parseFloat(doc.y), lon: parseFloat(doc.x), src: '카카오리키워드' }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: '검색 결과 없음' }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
