exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

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

  // 경북 → 경상북도 등 시도명 변환
  const expandProvince = (addr) => {
    return addr
      .replace(/^경북/, '경상북도')
      .replace(/^경남/, '경상남도')
      .replace(/^전북/, '전라북도')
      .replace(/^전남/, '전라남도')
      .replace(/^충북/, '충청북도')
      .replace(/^충남/, '충청남도')
      .replace(/^강원/, '강원도')
      .replace(/^경기/, '경기도')
      .replace(/^제주/, '제주특별자치도');
  };

  // 번지 제거
  const removeLot = (addr) => addr.replace(/\s+\d+(-\d+)?$/, '').trim();
  // 마지막 단위 제거
  const removeLastUnit = (addr) => { const p = addr.split(' '); return p.length > 2 ? p.slice(0, -1).join(' ') : addr; };

  try {
    let doc;
    const queries = [];

    // 원본
    queries.push(query);
    // 시도 풀네임으로 변환
    const expanded = expandProvince(query);
    if (expanded !== query) queries.push(expanded);
    // 번지 제거
    const simple = removeLot(query);
    if (simple !== query) {
      queries.push(simple);
      queries.push(expandProvince(simple));
    }
    // 리 단위만
    const region = removeLastUnit(simple);
    if (region !== simple) {
      queries.push(region);
      queries.push(expandProvince(region));
    }
    // 면 단위만
    const region2 = removeLastUnit(region);
    if (region2 !== region) {
      queries.push(region2);
    }

    // 모든 변형으로 카카오 주소검색
    for (const q of queries) {
      doc = await kakaoAddr(q);
      if (doc) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, lat: parseFloat(doc.y), lon: parseFloat(doc.x), src: `주소:${q}` }) };
    }

    // 모든 변형으로 카카오 키워드검색
    for (const q of queries) {
      doc = await kakaoKw(q);
      if (doc) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, lat: parseFloat(doc.y), lon: parseFloat(doc.x), src: `키워드:${q}` }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: false, error: '검색 결과 없음', tried: queries }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
```
