'use strict';
(() => {
  const vehicles = [
    { vehicle_number: 'UITS-001', vehicle_type: 'saloon', label: 'Saloon / Sedan', on_trip: true, heading: 90, left: 38, top: 40 },
    { vehicle_number: 'UITS-002', vehicle_type: 'suv_fullsize', label: 'Full-size SUV', on_trip: true, heading: 185, left: 58, top: 57 },
    { vehicle_number: 'UITS-003', vehicle_type: 'pickup', label: 'Pickup', on_trip: false, heading: 0, left: 30, top: 70 },
    { vehicle_number: 'UITS-004', vehicle_type: 'bus_coaster', label: 'Coaster Bus', on_trip: true, heading: 90, left: 78, top: 38 },
    { vehicle_number: 'UITS-005', vehicle_type: 'truck_light', label: 'Light Truck', stale: true, heading: 270, left: 65, top: 82 },
    { vehicle_number: 'UITS-006', vehicle_type: 'motorcycle', label: 'Motorcycle', on_trip: true, heading: 175, left: 31, top: 25 },
  ];
  const markers = document.getElementById('previewMarkers'), list = document.getElementById('previewList');
  const status = v => v.stale ? 'Last seen · 6 min ago' : v.on_trip ? 'On trip · just now' : 'Idle · just now';
  markers.innerHTML = vehicles.map((v,i) => `<button class="preview-marker" data-vehicle="${i}" style="left:${v.left}%;top:${v.top}%" aria-label="${v.vehicle_number}">${VMTL.vehicleMarkerSvg(v)}<strong>${v.vehicle_number}</strong></button>`).join('');
  list.innerHTML = vehicles.map((v,i) => `<button class="preview-row" data-vehicle="${i}">${VMTL.vehicleMarkerSvg(v)}<span><strong>${v.vehicle_number}</strong><small>${v.label} · ${status(v)}</small></span></button>`).join('');
  document.getElementById('previewTypes').innerHTML = vehicles.map(v => `<div class="preview-type">${VMTL.vehicleMarkerSvg({ ...v, heading: 0, stale: false, on_trip: true })}<strong>${v.label}</strong></div>`).join('');
  function select(index) { document.querySelectorAll('[data-vehicle]').forEach(el => el.classList.toggle('selected', Number(el.dataset.vehicle) === index)); }
  document.querySelectorAll('[data-vehicle]').forEach(el => el.onclick = () => select(Number(el.dataset.vehicle)));
  select(0);
})();
