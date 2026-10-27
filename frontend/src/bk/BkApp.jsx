import React,{useEffect} from 'react';
import {MemoryRouter,Routes,Route,Navigate} from 'react-router-dom';
import '@xyflow/react/dist/style.css';
import './bk.css';
import Hub from './pages/Hub';
import Studio from './pages/Studio';
import SandboxCenter from './pages/SandboxCenter';
import Sandbox from './pages/Sandbox';
import Monitoring from './pages/Monitoring';

// The platform's own pages (Agent Hub, Studio, Sandbox, Monitoring) with their original layout,
// recolored through tailwind.config.js. Navigation stays inside a MemoryRouter; links to pages that
// live elsewhere in the portal are forwarded to the portal's sidebar via `go`.
function Out({to,go}){useEffect(()=>{go(to)},[to]);return null}

export default function BkApp({me,initial='/hub',go,notify}){
  const role=me?.role||'user',builder=role!=='user';
  const user={uid:me?.uid,email:me?.email,displayName:me?.name};
  const gate=(ok,page)=>ok?page:<Navigate to="/hub" replace/>;
  return <div className="bk">
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/hub" element={<Hub user={user} role={role}/>}/>
        <Route path="/studio" element={<Navigate to="/hub" replace/>}/>
        <Route path="/studio/:id" element={gate(builder,<Studio/>)}/>
        <Route path="/sandbox" element={gate(builder,<SandboxCenter role={role}/>)}/>
        <Route path="/sandbox/:id" element={<Sandbox role={role}/>}/>
        <Route path="/monitoring" element={gate(role==='admin',<Monitoring/>)}/>
        <Route path="/audit" element={<Out to="稽核記錄" go={go}/>}/>
        <Route path="/connectors/*" element={<Out to="Connectors" go={go}/>}/>
        <Route path="/knowledge" element={<Out to="Library" go={go}/>}/>
        <Route path="/access/*" element={<Out to="Users" go={go}/>}/>
        <Route path="*" element={<Navigate to="/hub" replace/>}/>
      </Routes>
    </MemoryRouter>
  </div>;
}
