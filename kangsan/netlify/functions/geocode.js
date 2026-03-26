// netlify/functions/geocode.js
// 카카오 REST API 서버 호출 - 토지 지번주소 포함 5단계 폴백

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
    const r = await fetch(
      `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(q)}&size=1`,
      { headers: { Authorization: `KakaoAK ${KEY}` } }
    );
    const d = await r.json();
    return d.documents?.length > 0 ? d.documents[0] : null;
  };

  const kakaoKeyword = async (q) => {
    const r = await fetch(
      `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(q)}&size=1`,
      { headers: { Authorization: `KakaoAK ${KEY}` } }
    );
    const d = await r.json();
    return d.documents?.length > 0 ? d.documents[0] : null;
  };

  // 번지 제거: "경북 포항시 북구 청하면 월포리 275-8" → "경북 포항시 북구 청하면 월포리"
  const simplifyAddr = (addr) => addr.replace(/\s+\d+(-\d+)?(\s.*)?$/, '').trim();

  // 행정구역 축소: 마지막 단위 제거
  const regionOnly = (addr) => {
    const parts = addr.split(' ');
    return parts.length > 3 ? parts.slice(0, -1).join(' ') : addr;
  };

  try {
    let doc;

    // ① 원본 주소 검색
    doc = await kakaoAddr(query);
    if (doc) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, lat: parseFloat(doc.y), lon: parseFloat(doc.x), src: '주소검색' }) };

    // ② 원본 키워드 검색
    doc = await kakaoKeyword(query);
    if (doc) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, lat: parseFloat(doc.y), lon: parseFloat(doc.x), src: '키워드검색' }) };

    // ③ 번지 제거 후 주소검색 (토지 지번주소 핵심!)
    const simple = simplifyAddr(query);
    if (simple !== query) {
      doc = await kakaoAddr(simple);
      if (doc) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, lat: parseFloat(doc.y), lon: parseFloat(doc.x), src: '지번간략화' }) };

      // ④ 번지 제거 후 키워드 검색
      doc = await kakaoKeyword(simple);
      if (doc) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, lat: parseFloat(doc.y), lon: parseFloat(doc.x), src: '지번키워드' }) };
    }

    // ⑤ 면/읍 단위로 축소
    const region = regionOnly(simple);
    if (region !== simple) {
      doc = await kakaoAddr(region);
      if (doc) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, lat: parseFloat(doc.y), lon: parseFloat(doc.x), src: '행정구역' }) };

      doc = await kakaoKeyword(region);
      if (doc) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, lat: parseFloat(doc.y), lon: parseFloat(doc.x), src: '행정구역키워드' }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: '검색 결과 없음' }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
