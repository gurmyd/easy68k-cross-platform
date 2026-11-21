// Entry of gallery.html (development page). Owner: W2.

import { mountGallery } from './mount';
import { galleryRequest } from './route';

const container = document.getElementById('root');
if (!container) throw new Error('gallery.html has no #root element');
mountGallery(container, galleryRequest(`?gallery&${location.search.slice(1)}`) ?? { theme: 'system' });
