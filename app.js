(() => {
  'use strict';
  const stage = document.getElementById('tabletop');
  const canvas = document.getElementById('tabletop-canvas');
  const errorMessage = document.getElementById('load-error');
  let viewer;

  async function loadScan() {
    try {
      viewer = window.TabletopViewer.create({ canvas });
      let bytes;
      const embedded = document.getElementById('model-data');
      if (embedded) {
        const data = JSON.parse(embedded.textContent);
        const binary = atob(data.base64);
        bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      } else {
        const response = await fetch('assets/tabletop-scan.glb?v=remesh-100-8k-20261028');
        if (!response.ok) throw new Error('The scan could not be downloaded.');
        bytes = await response.arrayBuffer();
      }
      await viewer.loadFiles([new File([bytes], 'tabletop-scan.glb', { type: 'model/gltf-binary' })]);
      stage.dataset.ready = 'true';
      stage.setAttribute('aria-busy', 'false');
    } catch (error) {
      stage.setAttribute('aria-busy', 'false');
      stage.dataset.error = 'true';
      errorMessage.textContent = 'The 3D scan could not load. Please reload the page in a browser with WebGL enabled.';
      errorMessage.hidden = false;
      console.error('Tabletop scan:', error);
    }
  }

  canvas.addEventListener('dblclick', () => viewer?.resetView());
  window.addEventListener('pagehide', event => { if (!event.persisted) viewer?.dispose(); });
  loadScan();
})();
