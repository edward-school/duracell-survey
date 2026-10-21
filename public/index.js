document.getElementById('f').addEventListener('submit', function (e) {
  e.preventDefault();
  var c = document.getElementById('c').value.trim().toUpperCase();
  if (c) location.href = '/j/' + encodeURIComponent(c);
});
