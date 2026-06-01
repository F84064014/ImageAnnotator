import { useState } from 'react';
import Annotator from './Annotator';
import ProjectHome from './ProjectHome';

export default function App() {
  const [activeProjectId, setActiveProjectId] = useState(null);

  if (activeProjectId) {
    return <Annotator projectId={activeProjectId} onBack={() => setActiveProjectId(null)} />;
  }

  return <ProjectHome onOpenProject={setActiveProjectId} />;
}
