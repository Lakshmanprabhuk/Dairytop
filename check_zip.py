import zipfile, os, re, glob

# Check ALL zips in Downloads
zips = glob.glob(r'C:\Users\laxma\Downloads\*.zip')
print(f'Found {len(zips)} zips:')
for zp in sorted(zips):
    print(f'  {os.path.basename(zp)}')

# Also check if there's a cached zip anywhere in the project
project_zips = glob.glob(r'C:\Users\laxma\Downloads\knitworks-dashboard\**\*.zip', recursive=True)
for zp in project_zips:
    print(f'  {zp}')

# Ask user which one to check
zp = input('\nEnter full path to the DairyTop zip: ').strip()
with zipfile.ZipFile(zp) as zf:
    tables = set()
    for name in zf.namelist():
        if name.endswith('.csv'):
            base = os.path.splitext(os.path.basename(name))[0].lower()
            tbl = re.sub(r'_\d{4}-\d{2}-\d{2}$', '', base)
            tables.add(tbl)
    print(f'\nAll tables containing "rel":')
    for t in sorted(tables):
        if 'rel' in t:
            print(f'  {t}')