import { Button, Kbd, Modal } from '../components';
import { arrowNav } from '../nav/arrowNav';

export type HubMenuAction = 'save' | 'load' | 'settings' | 'pedia' | 'menu';

/** Esc on the hub: the program menu (Resume first, Enter resumes; arrows move). */
export function HubMenu({ onClose, act }: { onClose: () => void; act: (a: HubMenuAction) => void }) {
  return (
    <Modal title="Space Center" onClose={onClose} className="ui-modal-small hub-menu">
      <div className="hub-menu-list" onKeyDown={e => arrowNav(e)}>
        <Button className="btn primary" data-autofocus onClick={onClose}>Resume <Kbd>Esc</Kbd></Button>
        <div className="label">Program</div>
        <Button className="btn" onClick={() => act('save')}>Save as…</Button>
        <Button className="btn" onClick={() => act('load')}>Load…</Button>
        <div className="label">Options</div>
        <Button className="btn" onClick={() => act('settings')}>Settings</Button>
        <Button className="btn" onClick={() => act('pedia')}>Spacepedia</Button>
        <div className="label">Leave</div>
        <Button className="btn" onClick={() => act('menu')}>Main menu</Button>
      </div>
    </Modal>
  );
}
