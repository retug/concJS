// This is a file to contain all functionality for material defintions and shape defintions.
// Materials are a class contained in _______
// Shapes are a function to create a _______ base class.

export function toggleMaterialsAndShapesDiv() {
    const materialsAndShapes = document.getElementById('materialsandShapes');
    const button = document.querySelector('.toggle-button');
    const closedContainer = document.getElementById('materialsandShapesClosed');
    const expandedContainer = document.getElementById('materialsandShapesExpanded');

    if (materialContent.style.display === 'none') {
        // Show content and reset width
        materialContent.style.display = 'block';
        materialsAndShapes.style.width = '16.666%'; // Reset to default width
        button.innerHTML = '&#xab;'; // Left-pointing double arrow
        button.setAttribute('data-tooltip', 'Close materials and shapes');

        // Move button back to expanded container
        expandedContainer.appendChild(button);
        button.style.position = 'static'; // Reset button position
    } else {
        // Hide content and shrink the container
        materialContent.style.display = 'none';
        materialsAndShapes.style.width = '0'; // Collapse width
        materialsAndShapes.style.overflow = 'hidden'; // Hide overflow

        // Move button to the closed container
        closedContainer.appendChild(button);
        button.style.position = 'absolute'; // Keep button positioned
        button.style.top = '10px'; // Set distance from the top
        button.style.right = '10px'; // Set distance from the right
        button.innerHTML = '&#xbb;'; // Right-pointing double arrow
        button.setAttribute('data-tooltip', 'Show materials and shapes');
    }
}

export function toggleShapeButtons() {
    const rectangleButton = document.getElementById("rectangleButton");
    const barbellButton = document.getElementById("barbellButton");
  
    rectangleButton.addEventListener("click", () => {
      rectangleButton.classList.add("active");
      barbellButton.classList.remove("active");
    });
  
    barbellButton.addEventListener("click", () => {
      barbellButton.classList.add("active");
      rectangleButton.classList.remove("active");
    });
}

