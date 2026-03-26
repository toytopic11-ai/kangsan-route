exports.handler = async (event) => {
  const h = {'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};
  if (event.httpMethod === 'OPTIONS') return {statusCode:200,headers:h,body:''};
  const q0 = event.queryStringParameters && event.queryStringParameters.q;
  if (!q0) return {statusCode:400,headers:h,body:JSON.stringify({error:'q필요'})};
  const JUSO_KEY = process.env.JUSO_KEY;
  if (!JUSO_KEY) return {statusCode:500,headers:h,body:JSON.stringify({error:'JUSO_KEY 미설정'})};

  async function jusoCoord(q) {
    try {
      var url = 'https://business.juso.go.kr/addrlink/addrCoordApi.do?confmKey='+JUSO_KEY+'&currentPage=1&countPerPage=1&keyword='+encodeURIComponent(q)+'&format=json&coordType=GRS80';
      var r = await fetch(url);
      var d = await r.json();
      var items = d.results && d.results.juso;
      if (items && items.length > 0) return items[0];
      return null;
    } catch(e) { return null; }
  }

  function expand(s) {
    return s.replace(/^경북/,'경상북도').replace(/^경남/,'경상남도').replace(/^전북/,'전라북도').replace(/^전남/,'전라남도').replace(/^충북/,'충청북도').replace(/^충남/,'충청남도');
  }
  function removeLot(s) { return s.replace(/\s+\d+(-\d+)?$/,'').trim(); }

  var queries = [q0, expand(q0), removeLot(q0), expand(removeLot(q0))];

  for (var i=0; i<queries.length; i++) {
    var doc = await jusoCoord(queries[i]);
    if (doc && doc.entX && doc.entY) {
      return {statusCode:200,headers:h,body:JSON.stringify({ok:true,lat:parseFloat(doc.entY),lon:parseFloat(doc.entX),src:'juso:'+queries[i]})};
    }
  }

  return {statusCode:200,headers:h,body:JSON.stringify({ok:false,error:'검색실패',tried:queries})};
};
