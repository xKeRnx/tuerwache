// All callers pass through the server's session, role and CSRF checks.
export async function operationsPost(features,path,body,user){
  const ops=features.operations;
  switch(path){
    case '/api/operations/settings':return ops.update(body);
    case '/api/operations/check':await ops.tick();return ops.state();
    case '/api/retention/preview':return ops.retention.preview();
    case '/api/retention/run':
      if(body.confirm!==true)throw Error('Aufbewahrungsregeln zuerst prüfen und bestätigen.');
      return ops.retention.run();
    case '/api/backups/create':return ops.backups.start('create',body);
    case '/api/backups/verify':return ops.backups.start('verify',body);
    case '/api/clips/protect':{
      if(typeof body.protected!=='boolean')throw Error('Schutzeinstellung ungültig.');
      const entry=features.entry(body.id);entry.protected=body.protected;features.save();return {protected:entry.protected};
    }
    case '/api/quality/review':return features.quality.review(body,user||{id:'local'});
    case '/api/quality/compare':return features.quality.compare(body);
    default:return null;
  }
}
