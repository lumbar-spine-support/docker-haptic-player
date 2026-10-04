import './skin';
import '../ui/loop-button';
import '../ui/skip-button';
import '../ui/chapter-markers';
import skinHTML from './skin.html';
import { defineSkin } from '../skins/define-skin';

defineSkin('video-compat-skin', skinHTML);
