// netlify/functions/reverse-geocode.js
// GPS 좌표 → 한국 주소 변환 (카카오 REST API 서버 호출)

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const { lat, lon } = event.queryStringParameters || {};
  if (!lat || !lon) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'lat, lon 파라미터가 필요합니다' }) };
  }

  const KAKAO_REST_KEY = process.env.KAKAO_REST_KEY;
  if (!KAKAO_REST_KEY) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'KAKAO_REST_KEY 미설정' }) };
  }

  try {
    const res = await fetch(
      `https://dapi.kakao.com/v2/local/geo/coord2address.json?x=${lon}&y=${lat}`,
      { headers: { Authorization: `KakaoAK ${KAKAO_REST_KEY}` } }
    );
    const data = await res.json();

    if (data.documents && data.documents.length > 0) {
      const doc = data.documents[0];
      const addr = doc.road_address
        ? doc.road_address.address_name
        : doc.address.address_name;
      return {
        statusCode: 200, headers,
        body: JSON.stringify({ ok: true, address: addr }),
      };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: false }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
