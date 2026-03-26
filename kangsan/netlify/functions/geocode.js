exports.handler = async (event) => {
  const h = {'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};
  if (event.httpMethod === 'OPTIONS') return {statusCode:200,headers:h,body:''};
  const q0 = event.queryStringParameters && event.queryStringParameters.q;
  if (!q0) return {statusCode:400,headers:h,body:JSON.stringify({error:'q필요'})};
  const KEY = process.env.KAKAO_REST_KEY;
  if (!KEY) return {statusCode:500,headers:h,body:JSON.stringify({error:'키없음'})};

  try {
    var r = await fetch(
      'https://dapi.kakao.com/v2/local/search/address.json?query='+encodeURIComponent('포항시 북구')+'&size=1',
      {headers:{Authorization:'KakaoAK '+KEY}}
    );
    var d = await r.json();
    return {statusCode:200,headers:h,body:JSON.stringify({debug:true,status:r.status,response:d})};
  } catch(e) {
    return {statusCode:200,headers:h,body:JSON.stringify({error:e.message})};
  }
};
