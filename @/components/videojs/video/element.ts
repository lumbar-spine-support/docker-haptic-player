import './skin';
import '../ui/loop-button';
import '../ui/favorite-button';
import '../ui/vr-buttons';
import '../ui/skip-button';
import '../ui/chapter-snap';
import '../ui/time-slider.css';
import skinHTML from './skin.html';
import { defineSkin } from '../skins/define-skin';

defineSkin('video-compat-skin', skinHTML);
