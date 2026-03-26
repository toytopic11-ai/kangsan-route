exports.handler = async (event) => {
  const h = {'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};
  if (event.httpMethod === 'OPTIONS') return {statusCode:200,headers:h,body:''};
  const q0 = event.queryStringParameters && event.queryStringParameters.q;
  if (!q0) return {statusCode:400,headers:h,body:JSON.stringify({error:'q필요'})};
  const KEY = process.env.KAKAO_REST_KEY;
  if (!KEY) return {statusCode:500,headers:h,body:JSON.stringify({error:'키없음'})};

  async function addr(q) {
    try {
      var r = await fetch('https://dapi.kakao.com/v2/local/search/address.json?query='+encodeURIComponent(q)+'&size=1',{headers:{Authorization:'KakaoAK '+KEY}});
      var d = await r.json();
      return d.documents && d.documents.length > 0 ? d.documents[0] : null;
    } catch(e) { return null; }
  }

  async function kw(q) {
    try {
      var r = await fetch('https://dapi.kakao.com/v2/local/search/keyword.json?query='+encodeURIComponent(q)+'&size=1',{headers:{Authorization:'KakaoAK '+KEY}});
      var d = await r.json();
      return d.documents && d.documents.length > 0 ? d.documents[0] : null;
    } catch(e) { return null; }
  }

  function expand(s) {
    return s.replace(/^경북/,'경상북도').replace(/^경남/,'경상남도').replace(/^전북/,'전라북도').replace(/^전남/,'전라남도').replace(/^충북/,'충청북도').replace(/^충남/,'충청남도');
  }

  function removeLot(s) { return s.replace(/\s+\d+(-\d+)?$/,'').trim(); }

  function removeLast(s) { var p=s.split(' '); return p.length>2?p.slice(0,-1).join(' '):s; }

  var qs = [];
  qs.push(q0);
  qs.push(expand(q0));
  var s1 = removeLot(q0);
  qs.push(s1);
  qs.push(expand(s1));
  var s2 = removeLast(s1);
  qs.push(s2);
  qs.push(expand(s2));
  var s3 = removeLast(s2);
  qs.push(s3);
  qs.push(expand(s3));

  var doc;
  for (var i=0; i<qs.length; i++) {
    doc = await addr(qs[i]);
    if (doc) return {statusCode:200,headers:h,body:JSON.stringify({ok:true,lat:parseFloat(doc.y),lon:parseFloat(doc.x),src:'주소:'+qs[i]})};
  }
  for (var i=0; i<qs.length; i++) {
    doc = await kw(qs[i]);
    if (doc) return {statusCode:200,headers:h,body:JSON.stringify({ok:true,lat:parseFloat(doc.y),lon:parseFloat(doc.x),src:'키워드:'+qs[i]})};
  }

  return {statusCode:200,headers:h,body:JSON.stringify({ok:false,error:'검색실패',tried:qs})};
};
