jest.mock('../src/models/DirectoryContact', () => ({
  findOneAndUpdate: jest.fn(),
  find: jest.fn(),
  deleteMany: jest.fn()
}));

jest.mock('../src/utils/encryption', () => ({
  sha256: jest.fn((value) => `hash:${String(value).trim().toLowerCase()}`)
}));

const DirectoryContact = require('../src/models/DirectoryContact');
const {
  removeDirectoryContactsForUser,
  purgeStaleUserDirectoryContacts
} = require('../src/utils/directory-sync');

describe('directory-sync cleanup helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('removeDirectoryContactsForUser elimina contactos sincronizados desde usuarios usando email normalizado', async () => {
    DirectoryContact.deleteMany.mockResolvedValue({ deletedCount: 1 });

    const deletedCount = await removeDirectoryContactsForUser({
      email: '  Areyes@Netics.CL '
    });

    expect(DirectoryContact.deleteMany).toHaveBeenCalledWith({
      source: 'User',
      emailHash: 'hash:areyes@netics.cl'
    });
    expect(deletedCount).toBe(1);
  });

  test('purgeStaleUserDirectoryContacts conserva hashes activos y elimina huérfanos', async () => {
    DirectoryContact.find.mockReturnValue({ select: jest.fn().mockResolvedValue([]) });
    DirectoryContact.deleteMany.mockResolvedValue({ deletedCount: 2 });

    const deletedCount = await purgeStaleUserDirectoryContacts([
      { email: 'analista1@soc.local' },
      { email: '  areyes@netics.cl ' }
    ]);

    expect(DirectoryContact.deleteMany).toHaveBeenCalledWith({
      source: 'User',
      $or: [
        { emailHash: { $exists: false } },
        { emailHash: '' },
        { emailHash: { $nin: ['hash:analista1@soc.local', 'hash:areyes@netics.cl'] } }
      ]
    });
    expect(deletedCount).toBe(2);
  });
});