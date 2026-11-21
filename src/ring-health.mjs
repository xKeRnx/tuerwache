// Observe only fixed SDK messages. OAuth/network error bodies remain suppressed.
export function observeRingTransport(service,message){
  if(!service||service.closed||typeof message!=='string')return false;
  if(!['Failed to connect push notification receiver','Connection to the push notification server has failed unexpectedly'].includes(message))return false;
  service.pushTransport={status:'error',at:new Date().toISOString()};return true;
}
