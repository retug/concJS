export function resizeThreeJsScene() {
    const concGui = document.getElementById('concGui');
    const canvas = document.querySelector('canvas');

    if (!concGui || !canvas) return;

    // Get new size
    const newWidth = concGui.clientWidth;
    const newHeight = concGui.clientHeight;

    // Update the renderer
    renderer.setSize(newWidth, newHeight);
    renderer.setPixelRatio(window.devicePixelRatio);

    // Force the canvas to match the new size
    canvas.style.width = `${newWidth}px`;
    canvas.style.height = `${newHeight}px`;

    // Adjust camera aspect ratio
    camera.aspect = newWidth / newHeight;
    camera.updateProjectionMatrix();
}