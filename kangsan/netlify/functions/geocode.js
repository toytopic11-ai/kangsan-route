exports.handler = async (event) => {
  const h = {'Access-Control-Allow-Origin':'*','Content-Type':'application/json'};
  if (event.httpMethod === 'OPTIONS') return {statusCode:200,headers:h,body:''};
  const q = event.queryStringParameters && event.queryStringParameters.q;
  if (!q) return {statusCode:400,headers:h,body:JSON.stringify({error:'q필요'})};
  
  // 좌표 변환 없이 주소 텍스트 그대로 반환 (지도 앱이 자체 처리)
  return {statusCode:200,headers:h,body:JSON.stringify({ok:true,lat:null,lon:null,addr:q,src:'텍스트'})};
};
